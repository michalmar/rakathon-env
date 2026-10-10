import { environment } from "./catalog";

export function parseUser(value: unknown): string {
  if (typeof value !== "object" || value === null || !("clientPrincipal" in value)) {
    throw new Error("Nepodařilo se ověřit přihlášení.");
  }
  const principal = value.clientPrincipal;
  if (
    typeof principal !== "object" || principal === null ||
    !("identityProvider" in principal) || principal.identityProvider !== "aad" ||
    !("userRoles" in principal) || !Array.isArray(principal.userRoles) ||
    !principal.userRoles.includes("authenticated") ||
    !("userDetails" in principal) || typeof principal.userDetails !== "string"
  ) throw new Error("Pro zobrazení katalogu se přihlaste účtem z Rakathon tenantu.");
  if ("claims" in principal) {
    if (!Array.isArray(principal.claims)) throw new Error("Neplatné údaje přihlášení.");
    for (const claim of principal.claims) {
      if (
        typeof claim === "object" && claim !== null && "typ" in claim && "val" in claim &&
        (claim.typ === "tid" || claim.typ === "http://schemas.microsoft.com/identity/claims/tenantid") &&
        claim.val !== environment.tenantId
      ) throw new Error("Tento účet nepatří do Rakathon tenantu.");
    }
  }
  return principal.userDetails;
}
