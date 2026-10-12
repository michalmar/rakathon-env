"use strict";

const { ManagedIdentityCredential } = require("@azure/identity");
const {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
} = require("@azure/storage-blob");
const { HttpError } = require("./lib");

const LINK_LIFETIME_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

function contentDisposition(blobName) {
  const fileName = blobName.split("/").at(-1) || "download";
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function createBlobLink(blobName, env) {
  if (!/^[a-z0-9]{3,24}$/.test(env.STORAGE_ACCOUNT_NAME ?? "")) {
    throw new HttpError(500, "configuration-error");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(env.STORAGE_CONTAINER ?? "")) {
    throw new HttpError(500, "configuration-error");
  }

  const credential = new ManagedIdentityCredential();
  const service = new BlobServiceClient(
    `https://${env.STORAGE_ACCOUNT_NAME}.blob.core.windows.net`,
    credential,
  );
  const blob = service.getContainerClient(env.STORAGE_CONTAINER).getBlobClient(blobName);
  try {
    await blob.getProperties();
  } catch (error) {
    if (error?.statusCode === 404) throw new HttpError(404, "blob-not-found");
    throw new HttpError(502, "storage-error");
  }

  const now = Date.now();
  const startsOn = new Date(now - CLOCK_SKEW_MS);
  const expiresOn = new Date(now + LINK_LIFETIME_MS);
  let delegationKey;
  try {
    delegationKey = await service.getUserDelegationKey(startsOn, expiresOn);
  } catch {
    throw new HttpError(502, "storage-error");
  }
  const query = generateBlobSASQueryParameters({
    containerName: env.STORAGE_CONTAINER,
    blobName,
    permissions: BlobSASPermissions.parse("r"),
    startsOn,
    expiresOn,
    contentDisposition: contentDisposition(blobName),
  }, delegationKey, env.STORAGE_ACCOUNT_NAME).toString();

  return {
    blobUrl: blob.url,
    downloadUrl: `${blob.url}?${query}`,
    expiresAt: expiresOn.toISOString(),
  };
}

module.exports = { createBlobLink };
