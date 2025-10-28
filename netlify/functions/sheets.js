// netlify/functions/sheets.js
const { google } = require('googleapis');

exports.handler = async () => {
  try {
    // --- Credentials from Netlify environment ---
    // Recommended: GOOGLE_SERVICE_ACCOUNT_JSON (Option A from earlier)
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

    // 1) Home Page content
    const homeResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Home Page'!A2:C2`,
    });
    const [A2 = '', B2 = '', C2 = ''] = (homeResp.data.values && homeResp.data.values[0]) || [];
    const home = {
      title: String(A2 || '').trim(),
      intro1: String(B2 || '').trim(),
      intro2: String(C2 || '').trim(),
    };

    // 2) Job Titles
    const jobsResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Job Titles'!A2:B`,
    });
    const jobsRaw = (jobsResp.data.values || []).filter(r => r[0]);
    const jobs = jobsRaw.map(r => ({
      name: String(r[0]).trim(),
      notionBlurb: (r[1] || '').trim(),   // optional – Notion page for the job’s blurb
    }));

    // 3) Sections per Job (tab per job name)
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
          .map(r => ({
            title: String(r[0]).trim(),
            notionUrl: (r[1] || '').trim(),
          }));
      } catch (e) {
        // If tab doesn't exist yet, just return empty list
        sectionsByJob[job.name] = [];
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ home, jobs, sectionsByJob }),
    };
  } catch (err) {
    console.error('[sheets] error:', err);
    return { statusCode: 500, body: 'Sheets read error' };
  }
};
