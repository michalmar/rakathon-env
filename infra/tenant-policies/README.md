# Subscription governance policies

`main.bicep` deploys six custom policy definitions, an initiative with nine
references (including the built-in disallowed resource types policy), and an
enforced assignment at the target subscription. Its resource groups and resources
inherit the assignment; other subscriptions are not affected.

The rules and initiative parameters are supplied by `policy-data.json`:

- Block the listed H-, M-, and N-series VM and VMSS sizes, except Spot.
- Require one AKS node pool named `nodepool1`, with at most three configured
  nodes and an autoscaling maximum of three. Check both cluster and child
  node-pool requests; deny other pool names, Automatic clusters, automatic node
  provisioning, and VirtualMachines pools with alternative capacity settings.
- Deny VMSS capacity greater than three instances.
- Deny Azure OpenAI deployments using `ProvisionedManaged`,
  `GlobalProvisionedManaged`, or `DataZoneProvisionedManaged`.
- Deny Log Analytics workspace capacity reservations greater than 100.
- Deny the listed classic resource types.
- Deny Managed HSM purge protection unless the resource or resource group has
  `CostControl=Ignore`.

These are the supplied rules, not comprehensive SKU-family restrictions.
Spot remains exempt from the VM size policy, but not the separate VMSS
instance-count limit. The malformed N-series entries have been separated into
the documented legacy ND sizes. The unrecognized `standard_nd40s_v3` fragment
was removed; the existing verified `standard_nd40rs_v2` entry remains.
The Managed HSM purge-protection restriction is intentional.

The fixed AKS pool name prevents separate child-resource requests from adding
more pools, because Azure Policy cannot inspect sibling pools during those
requests. Set `AllowedNodePoolName` in the AKS initiative reference if a different
name is required, consistently across all clusters. The three-node cap applies
to configured capacity and autoscaling, not temporary upgrade surge nodes.
Existing clusters with other pool names or layouts can have updates denied.

Run the policy regression checks with:

```bash
node --test infra/tenant-policies/tests/policies.test.mjs
```

## Access and deployment

The deploying identity needs subscription read access, policy definition,
initiative and assignment write access, and ARM deployment permissions at the
target scope. Contributor alone does not provide policy write access. A
subscription Owner has the required permissions unless restricted by a deny
assignment or other governance controls. Alternatively, an administrator can
grant Resource Policy Contributor plus subscription read and deployment
permissions, or another approved role covering these actions. Management group
access is not required.

Set `SUBSCRIPTION_ID` to the approved target and `DEPLOYMENT_LOCATION` to the
region used to store deployment metadata. The deployment location does not
restrict where governed resources can be created.

```bash
export AZURE_CONFIG_DIR="$HOME/.azure-rak"
export SUBSCRIPTION_ID="<subscription-id>"
export DEPLOYMENT_LOCATION="<deployment-metadata-region>"

az deployment sub validate \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$DEPLOYMENT_LOCATION" \
  --name tenant-policies \
  --template-file infra/tenant-policies/main.bicep

az deployment sub what-if \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$DEPLOYMENT_LOCATION" \
  --name tenant-policies \
  --template-file infra/tenant-policies/main.bicep
```

After reviewing the scope, rules and what-if result, deploy and verify:

```bash
az deployment sub create \
  --subscription "$SUBSCRIPTION_ID" \
  --location "$DEPLOYMENT_LOCATION" \
  --name tenant-policies \
  --template-file infra/tenant-policies/main.bicep

az policy assignment show \
  --subscription "$SUBSCRIPTION_ID" \
  --name gov-deny-policies \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

The default initiative name is `GovernanceDenyPolicies`; the default assignment
name is `gov-deny-policies`. Override them with `--parameters initiativeName=...
assignmentName=...` consistently across validation, what-if and deployment.
The assignment uses `enforcementMode: Default`, has no exclusions, and needs no
managed identity because its policies use only Deny effects. Existing resources
are not deleted or remediated; subsequent creates or updates that violate the
rules can be denied. Compliance evaluation is asynchronous.
