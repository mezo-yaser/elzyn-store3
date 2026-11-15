const { handler } = require('../server');

/* غلاف دالة Vercel: أي خطأ غير متوقع بيترد عليه بـ JSON بدل ما الدالة تنهار
   وترجّع صفحة 500 FUNCTION_INVOCATION_FAILED. */
module.exports = (req, res) => {
  try {
    // Vercel rewrites dynamic data/image URLs through this function.
    if (req.url === '/api/data.js' || req.url.startsWith('/api/data.js?')) {
      req.url = req.url.replace('/api/data.js', '/data.js');
    } else if (req.url.startsWith('/api/uploads/')) {
      req.url = req.url.replace('/api/uploads/', '/uploads/');
    } else if (req.url === '/api/ping' || req.url.startsWith('/api/ping?')) {
      req.url = '/ping';
    }
    return Promise.resolve(handler(req, res)).catch(err => fail(res, err));
  } catch (err) { fail(res, err); }
};

function fail(res, err) {
  console.error('function error:', err && err.message);
  try {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'خطأ مؤقت، جرّب تاني' }));
  } catch (e) {}
}
