// Proof-upload checks for the public demo: type allow-list, size cap, magic bytes, and sane text/URL lengths.

export const ALLOWED_TYPES = {
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
};

const bad = (status, code, message) => Object.assign(new Error(message), { status, code });

/**
 * Validate a submit body ({ text, url, image_data_url }). Returns the cleaned evidence or throws an error
 * with .status 400 / 413 / 415. maxBytes caps the decoded file size.
 */
export function checkEvidence(body = {}, { maxBytes = 2 * 1024 * 1024, maxText = 4000 } = {}) {
  const out = {};
  if (body.text != null) {
    if (typeof body.text !== 'string') throw bad(400, 'BAD_EVIDENCE', 'text must be a string');
    if (body.text.length > maxText) throw bad(413, 'EVIDENCE_TOO_LARGE', `Notes are limited to ${maxText} characters`);
    out.text = body.text;
  }
  if (body.url != null && body.url !== '') {
    if (typeof body.url !== 'string' || body.url.length > 2048) throw bad(400, 'BAD_EVIDENCE', 'url must be a string under 2048 characters');
    let u; try { u = new URL(body.url); } catch { throw bad(400, 'BAD_EVIDENCE', 'url is not a valid URL'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw bad(400, 'BAD_EVIDENCE', 'Only http and https URLs can be checked');
    if (u.username || u.password) throw bad(400, 'BAD_EVIDENCE', 'URLs with credentials are not accepted');
    out.url = body.url;
  }
  if (body.image_data_url != null && body.image_data_url !== '') {
    const v = body.image_data_url;
    if (typeof v !== 'string') throw bad(400, 'BAD_EVIDENCE', 'image_data_url must be a data URL');
    const m = /^data:([a-z0-9.+/-]+);base64,/i.exec(v.slice(0, 100));
    if (!m) throw bad(400, 'BAD_EVIDENCE', 'image_data_url must be a base64 data URL');
    const type = m[1].toLowerCase();
    if (!ALLOWED_TYPES[type]) throw bad(415, 'UNSUPPORTED_FILE', `Allowed files: PNG, JPEG, WebP, GIF or PDF (got ${type.slice(0, 40)})`);
    const b64 = v.slice(m[0].length);
    if (b64.length > Math.ceil(maxBytes / 3) * 4 + 4) throw bad(413, 'FILE_TOO_LARGE', `Files are limited to ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw bad(400, 'BAD_EVIDENCE', 'File data is not valid base64');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > maxBytes) throw bad(413, 'FILE_TOO_LARGE', `Files are limited to ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB`);
    if (buf.length < 8 || !ALLOWED_TYPES[type](buf)) throw bad(415, 'UNSUPPORTED_FILE', 'File content does not match its type');
    out.image_data_url = v;
  }
  return out;
}
