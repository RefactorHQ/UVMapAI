const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const normalizeBaseUrl = (value: string) => value.replace(/\/+$/, '');

export const getAssetServiceBaseUrl = () => {
  const assetServiceBaseUrl = process.env.ASSET_SERVICE_BASE_URL;
  if (!assetServiceBaseUrl) {
    throw new Error('ASSET_SERVICE_BASE_URL is not configured.');
  }

  return normalizeBaseUrl(assetServiceBaseUrl);
};

export async function postAssetServiceFormData(
  pathname: string,
  formData: FormData,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    return await fetch(`${getAssetServiceBaseUrl()}${pathname}`, {
      method: 'POST',
      body: formData,
      cache: 'no-store',
      signal: abortController.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Asset optimization request timed out.');
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
