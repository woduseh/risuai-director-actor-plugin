import { Buffer } from 'node:buffer'

let cachedPrivateKeyPem: Promise<string> | null = null

function toPem(pkcs8: ArrayBuffer): string {
  const base64 = Buffer.from(pkcs8).toString('base64')
  const lines = base64.match(/.{1,64}/g) ?? []
  return [
    '-----BEGIN PRIVATE KEY-----',
    ...lines,
    '-----END PRIVATE KEY-----',
  ].join('\n')
}

async function getPrivateKeyPem(): Promise<string> {
  if (!cachedPrivateKeyPem) {
    cachedPrivateKeyPem = (async () => {
      const keyPair = await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
      )
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      return toPem(pkcs8)
    })()
  }
  return cachedPrivateKeyPem
}

export async function createVertexServiceAccountJson(
  overrides?: Partial<{
    project_id: string
    client_email: string
    private_key: string
  }>,
): Promise<string> {
  return JSON.stringify({
    type: 'service_account',
    project_id: overrides?.project_id ?? 'vertex-test-project',
    private_key_id: 'vertex-test-key-id',
    private_key: overrides?.private_key ?? (await getPrivateKeyPem()),
    client_email:
      overrides?.client_email ??
      'vertex-test@vertex-test-project.iam.gserviceaccount.com',
    client_id: '1234567890',
    token_uri: 'https://oauth2.googleapis.com/token',
  })
}
