const express = require('express');
const app = express();
app.use(express.json());

app.get('/sync', (req, res) => {
    res.json({ kill_switch: 'OFF', multiplier: 1.0, min_confidence: 65 });
});

app.get('/health', (req, res) => res.send('OK'));

app.post('/validate', (req, res) => {
    res.send('AUTHORIZED|30-12-2036|Test Client|10000|PRO');
});

app.post('/hoot', (req, res) => res.send('HOOT_SENT'));
app.post('/close', (req, res) => res.send('CLOSE_OK'));
app.post('/billing', (req, res) => res.send('SUCCESS'));
app.post('/positions', (req, res) => res.send('OK'));
app.post('/trade_log', (req, res) => res.send('OK'));
app.post('/eod', (req, res) => res.send('OK'));
app.post('/client_eod', (req, res) => res.send('OK'));
app.post('/activation', (req, res) => res.send('OK'));
app.post('/position_update', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log('Uluka Backend running on port ' + PORT));
