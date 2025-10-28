// /api/sheets.js  (Vercel Serverless Function)
const { google } = require('googleapis');

module.exports = async (req, res) => {
  // Optional: only allow GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const spreadsheetId = process.env.SHEET_ID;

    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets.readonly',
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Home Page
    const homeResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Home Page'!A2:C2`,
    });
    const [A2 = '', B2 = '', C2 = ''] = (homeResp.data.values && homeResp.data.values[0]) || [];
    const home = { title: String(A2 || '').trim(), intro1: String(B2 || '').trim(), intro2: String(C2 || '').trim() };

    // Job Titles
    const jobsResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Job Titles'!A2:B`,
    });
    const jobsRaw = (jobsResp.data.values || []).filter(r => r[0]);
    const jobs = jobsRaw.map(r => ({ name: String(r[0]).trim(), notionBlurb: (r[1] || '').trim() }));

    // Sections per job (tab per job name)
    const sectionsByJob = {};
    for (const job of jobs) {
      try {
        const secResp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${job.name}'!A2:B`,
        });
        const rows = secResp.data.values || [];
        sectionsByJob[job.name] = rows
          .filter(r => r[0])
          .map(r => ({ title: String(r[0]).trim(), notionUrl: (r[1] || '').trim() }));
      } catch {
        sectionsByJob[job.name] = [];
      }
    }

    res.setHeader('Content-Type', 'application/json');
    // If you ever host the front-end on another domain, uncomment the CORS line:
    // res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).send(JSON.stringify({ home, jobs, sectionsByJob }));
  } catch (err) {
    console.error('[sheets] error:', err);
    return res.status(500).send('Sheets read error');
  }
};
