export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' })
    return
  }

  const apiKey = globalThis.process?.env?.REACTOR_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Missing REACTOR_API_KEY' })
    return
  }

  try {
    const response = await fetch('https://api.reactor.inc/tokens', {
      method: 'POST',
      headers: { 'Reactor-API-Key': apiKey },
    })

    if (!response.ok) {
      const text = await response.text()
      res.status(response.status).json({ error: text || 'Token request failed' })
      return
    }

    const data = await response.json()
    res.status(200).json({ jwt: data.jwt })
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Token request failed' })
  }
}
