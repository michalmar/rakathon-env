targetScope = 'subscription'

var policyData = loadJsonContent('policy-data.json')

@description('Name of the initiative to create in the destination subscription.')
@minLength(1)
@maxLength(64)
param initiativeName string = 'GovernanceDenyPolicies'

@description('Name of the initiative assignment at the destination subscription.')
@minLength(1)
@maxLength(24)
param assignmentName string = 'gov-deny-policies'

var initiativeReferences = [
  for reference in policyData.initiative.properties.policyDefinitions: {
    policyDefinitionId: startsWith(reference.policyDefinitionId, '/providers/Microsoft.Authorization/policyDefinitions/')
      ? reference.policyDefinitionId
      : subscriptionResourceId('Microsoft.Authorization/policyDefinitions', reference.policyDefinitionId)
    policyDefinitionReferenceId: reference.policyDefinitionReferenceId
    definitionVersion: reference.definitionVersion
    parameters: reference.parameters
  }
]

resource customPolicies 'Microsoft.Authorization/policyDefinitions@2025-03-01' = [
  for policy in policyData.customPolicies: {
    name: policy.name
    properties: policy.properties
  }
]

resource initiative 'Microsoft.Authorization/policySetDefinitions@2025-03-01' = {
  name: initiativeName
  properties: union(policyData.initiative.properties, {
    policyDefinitions: initiativeReferences
  })
  dependsOn: [
    customPolicies
  ]
}

resource assignment 'Microsoft.Authorization/policyAssignments@2025-03-01' = {
  name: assignmentName
  properties: {
    displayName: initiative.properties.displayName
    description: 'Enforce governance deny policies in this subscription.'
    policyDefinitionId: initiative.id
    enforcementMode: 'Default'
    nonComplianceMessages: [
      {
        message: 'This resource is blocked by the subscription governance deny policies.'
      }
    ]
  }
}

output initiativeId string = initiative.id
output customPolicyIds array = [for (policy, index) in policyData.customPolicies: customPolicies[index].id]
output assignmentId string = assignment.id
