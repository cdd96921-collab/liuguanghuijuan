import https from 'https';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const API_KEY = process.env.NVIDIA_API_KEY;
        if (!API_KEY) {
            return res.status(500).json({ error: 'API Key not configured' });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const payload = JSON.stringify({
            ...body,
            model: 'minimaxai/minimax-m3',
        });

        await new Promise((resolve, reject) => {
            const options = {
                hostname: 'integrate.api.nvidia.com',
                path: '/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Length': Buffer.byteLength(payload),
                },
            };

            const request = https.request(options, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        const result = JSON.parse(data);
                        res.status(response.statusCode).json(result);
                        resolve();
                    } catch (e) {
                        res.status(response.statusCode).send(data);
                        resolve();
                    }
                });
            });

            request.on('error', (error) => {
                res.status(500).json({ error: error.message });
                reject(error);
            });

            request.write(payload);
            request.end();
        });

    } catch (error) {
        console.error('AI Proxy Error:', error);
        res.status(500).json({ error: error.message });
    }
}
