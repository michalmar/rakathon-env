import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const data = JSON.parse(readFileSync(new URL('../policy-data.json', import.meta.url), 'utf8'));
const policy = name => data.customPolicies.find(item => item.name === name).properties;
const clusterType = 'Microsoft.ContainerService/managedClusters';
const poolType = `${clusterType}/agentPools`;
const poolsField = `${clusterType}/agentPoolProfiles[*]`;

function evaluate(rule, fields, parameters = {}, scope) {
  const normalized = Object.fromEntries(Object.entries(rule).map(([key, value]) => [key.toLowerCase(), value]));
  if (normalized.allof) return normalized.allof.every(item => evaluate(item, fields, parameters, scope));
  if (normalized.anyof) return normalized.anyof.some(item => evaluate(item, fields, parameters, scope));
  if (normalized.not) return !evaluate(normalized.not, fields, parameters, scope);

  let value;
  if (normalized.count) {
    const { field, where } = normalized.count;
    value = (fields[field] ?? []).filter(item =>
      !where || evaluate(where, fields, parameters, { field, item })
    ).length;
  } else if (normalized.field) {
    value = scope && normalized.field.startsWith(`${scope.field}.`)
      ? scope.item[normalized.field.slice(scope.field.length + 1)]
      : fields[normalized.field];
  } else {
    throw new Error(`Unsupported policy expression: ${JSON.stringify(rule)}`);
  }

  const resolve = input => {
    const match = typeof input === 'string' && input.match(/^\[parameters\('([^']+)'\)\]$/);
    return match ? parameters[match[1]] : input;
  };
  const equal = (left, right) => typeof left === 'string' && typeof right === 'string'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
  if ('equals' in normalized) return equal(value, resolve(normalized.equals));
  if ('notequals' in normalized) return !equal(value, resolve(normalized.notequals));
  if ('in' in normalized) return resolve(normalized.in).some(item => equal(value, item));
  if ('greater' in normalized) return value > resolve(normalized.greater);
  throw new Error(`Unsupported policy comparison: ${JSON.stringify(rule)}`);
}

const aks = policy('AKS_LimitNodeCount_Deny');
const aksParameters = { AllowedNodePoolName: aks.parameters.AllowedNodePoolName.defaultValue };
const denied = fields => evaluate(aks.policyRule.if, fields, aksParameters);
const pool = (overrides = {}) => ({ name: 'nodepool1', count: 3, type: 'VirtualMachineScaleSets', ...overrides });
const cluster = (...pools) => ({ type: clusterType, [poolsField]: pools });
const child = values => ({
  type: poolType,
  ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key === 'name' ? key : `${poolType}/${key}`, value,
  ])),
});

test('AKS accepts one named pool with one to three configured nodes', () => {
  for (const count of [1, 2, 3]) {
    assert.equal(denied(cluster(pool({ count }))), false);
    assert.equal(denied(child(pool({ count }))), false);
  }
});

test('AKS denies four configured nodes through cluster and child requests', () => {
  assert.equal(denied(cluster(pool({ count: 4 }))), true);
  assert.equal(denied(child(pool({ count: 4 }))), true);
});

test('AKS enforces the autoscaling maximum at the three-node boundary', () => {
  for (const maxCount of [3, 4]) {
    const values = pool({ count: 1, enableAutoScaling: true, maxCount });
    assert.equal(denied(cluster(values)), maxCount > 3);
    assert.equal(denied(child(values)), maxCount > 3);
  }
});

test('AKS denies extra pools even when their aggregate count is three or less', () => {
  assert.equal(denied(cluster(pool({ count: 1 }), pool({ name: 'other', count: 1 }))), true);
  assert.equal(denied(child(pool({ name: 'other', count: 1 }))), true);
  assert.equal(denied(cluster(pool({ name: 'other', count: 1 }))), true);
});

test('AKS denies alternative capacity models and automatic provisioning', () => {
  assert.equal(denied(cluster(pool({ type: 'VirtualMachines' }))), true);
  assert.equal(denied(child(pool({ type: 'VirtualMachines' }))), true);
  assert.equal(denied({ ...cluster(pool()), [`${clusterType}/sku.name`]: 'Automatic' }), true);
  assert.equal(denied({ ...cluster(pool()), [`${clusterType}/nodeProvisioningProfile.mode`]: 'Auto' }), true);
  assert.equal(denied({ type: 'Microsoft.Storage/storageAccounts' }), false);
});

test('all provisioned OpenAI SKUs are denied while consumption SKUs remain allowed', () => {
  const rule = policy('AzureOpenAI_ProvisionedCapacity_Deny').policyRule.if;
  for (const sku of ['ProvisionedManaged', 'GlobalProvisionedManaged', 'DataZoneProvisionedManaged',
    'Standard', 'GlobalStandard', 'DataZoneStandard', 'GlobalBatch', 'DataZoneBatch']) {
    assert.equal(evaluate(rule, {
      type: 'Microsoft.CognitiveServices/accounts/deployments',
      'Microsoft.CognitiveServices/accounts/deployments/sku.name': sku,
    }), sku.endsWith('ProvisionedManaged'));
  }
});

test('explicit VM SKU lists still exempt Spot for both VM and VMSS', () => {
  const rule = policy('VirtualMachine_SKU_Deny').policyRule.if;
  for (const reference of data.initiative.properties.policyDefinitions.filter(item => item.parameters.BlockedSKUs)) {
    const parameters = { BlockedSKUs: reference.parameters.BlockedSKUs.value };
    for (const type of ['Microsoft.Compute/virtualMachines', 'Microsoft.Compute/virtualMachineScaleSets']) {
      const priorityField = type.endsWith('virtualMachines') ? 'priority' : 'virtualMachineProfile.priority';
      for (const priority of ['Regular', 'Spot']) {
        assert.equal(evaluate(rule, {
          type,
          [`${type}/sku.name`]: parameters.BlockedSKUs[0],
          [`${type}/${priorityField}`]: priority,
        }, parameters), priority !== 'Spot');
      }
      assert.equal(evaluate(rule, { type, [`${type}/sku.name`]: 'Standard_D2s_v5' }, parameters), false);
    }
  }
});

test('N-series entries are separated without retaining the unknown ND40s_v3 fragment', () => {
  const sizes = data.initiative.properties.policyDefinitions
    .find(item => item.policyDefinitionReferenceId === 'BlockVMSKUs_N').parameters.BlockedSKUs.value;
  for (const size of ['standard_nd6s', 'standard_nd12s', 'standard_nd24rs', 'standard_nd40rs_v2']) {
    assert.ok(sizes.includes(size));
  }
  assert.ok(sizes.every(size => (size.match(/standard_/g) ?? []).length === 1));
  assert.ok(!sizes.includes('standard_nd40s_v3'));
  assert.equal(new Set(sizes).size, sizes.length);
});

test('Managed HSM tag spelling matches the initiative override and retains Deny', () => {
  const hsm = policy('KeyVaultManagedHSM_PurgeProtectionEnabled_Deny');
  const reference = data.initiative.properties.policyDefinitions
    .find(item => item.policyDefinitionId === 'KeyVaultManagedHSM_PurgeProtectionEnabled_Deny');
  assert.equal(hsm.parameters.AllowedTagName.defaultValue, 'CostControl');
  assert.equal(hsm.parameters.AllowedTagName.defaultValue, reference.parameters.AllowedTagName.value);
  assert.equal(hsm.policyRule.then.effect, 'Deny');
});
