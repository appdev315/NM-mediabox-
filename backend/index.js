import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 7860;

app.use(cors());

console.log(`===== Application Startup at ${new Date().toISOString()} =====\n`);

app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
});

app.get('/', (req, res) => res.json({ status: 'OK', message: 'Parser is running in lightweight mode' }));

// Keep an empty stream endpoint for backwards compatibility during rollout
app.get('/api/stream', (req, res) => {
    res.status(404).json({ error: "Stream endpoint retired. Please use frontend balancers." });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port} in lightweight mode`);
});
