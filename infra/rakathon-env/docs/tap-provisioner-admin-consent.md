# Admin consent for Rakathon Team Provisioner

The `Rakathon Team Provisioner` app registration is intended to create
Temporary Access Passes for hackathon team accounts without an interactive
Microsoft Graph sign-in.

## Application details

- Tenant ID: obtain through the approved secure channel
- Application name: `Rakathon Team Provisioner`
- Application (client) ID: obtain through the approved secure channel
- Requested API: Microsoft Graph
- Requested application permission: `UserAuthMethod-TAP.ReadWrite.All`

Application credentials are configured outside the repository and must not be
shared or committed.

## Grant consent

This action requires `Privileged Role Administrator` or `Global Administrator`.

1. Sign in to [Microsoft Entra admin center](https://entra.microsoft.com/) and
   switch to the target tenant.
2. Open **Entra ID > App registrations > All applications**.
3. Search for and open **Rakathon Team Provisioner**. Confirm its application
   (client) ID against the value received through the approved secure channel.
4. Open **Manage > API permissions**.
5. Confirm that the configured permissions table contains only the Microsoft Graph
   **application** permission `UserAuthMethod-TAP.ReadWrite.All`.
6. Select **Grant admin consent for VZPCRRAKATON** and confirm.
7. Verify that the permission status shows **Granted for VZPCRRAKATON**.

Do not grant consent if the application ID or requested permission differs from
the values above.

The **Enterprise apps > Permissions** page displays permissions that are
already granted and can therefore show an empty list before consent. If the
admin is already on that page, use its **Application registration** link, then
open **API permissions**.

## Completion

After consent is granted, tell the implementer that admin consent is complete.
Do not create, send, or request application credentials.
