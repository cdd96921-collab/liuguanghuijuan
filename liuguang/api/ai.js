export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const API_KEY = process.env.NVIDIA_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ error: 'API Key not configured' });
    }

    try {
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                ...req.body,
                model: 'minimaxai/minimax-m3',
            }),
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('AI Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
}
