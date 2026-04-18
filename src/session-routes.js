const express = require('express');
const sessions = require('./sessions');
const { apiKeyAuth } = require('./auth');

const router = express.Router();

router.use(apiKeyAuth);

router.post('/create', async (req, res) => {
  try {
    const result = await sessions.create(req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/list', (req, res) => {
  res.json(sessions.listSessions());
});

router.post('/:id/goto', async (req, res) => {
  try {
    const result = await sessions.goto(req.params.id, req.body.url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/content', async (req, res) => {
  try {
    const result = await sessions.content(req.params.id, req.query.format || 'html');
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/fill', async (req, res) => {
  try {
    const result = await sessions.fill(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/click', async (req, res) => {
  try {
    const result = await sessions.click(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/select', async (req, res) => {
  try {
    const result = await sessions.selectOption(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/upload', async (req, res) => {
  try {
    const result = await sessions.upload(req.params.id, req.body);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/:id/screenshot', async (req, res) => {
  try {
    const result = await sessions.screenshot(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await sessions.close(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
