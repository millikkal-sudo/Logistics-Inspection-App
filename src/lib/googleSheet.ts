/**
 * Reads a Google Sheet from a shared link.
 *
 * No OAuth and no API key: Google exposes a CSV export for any sheet
 * that is link-viewable, so the whole thing is one fetch. The cost is
 * that the sheet has to be readable by anyone holding the URL while the
 * import runs. The UI says so, and says to switch it back afterwards.
 */

export class SheetError extends Error {}

type SheetTarget = { csvUrl: string; kind: 'standard' | 'published' };

/**
 * Accepts whatever the person copies out of the address bar:
 *   /spreadsheets/d/{id}/edit#gid=0
 *   /spreadsheets/d/{id}/edit?gid=123456
 *   /spreadsheets/d/e/{token}/pubhtml        (File, Share, Publish to web)
 */
export const parseSheetUrl = (input: string): SheetTarget => {
  const trimmed = input.trim();

  if (trimmed === '') {
    throw new SheetError('Paste the link to your Google Sheet');
  }
  if (!trimmed.includes('docs.google.com/spreadsheets')) {
    throw new SheetError('That is not a Google Sheets link');
  }

  // A published sheet uses a one-way token rather than the file id, and
  // has its own export path.
  const published = /\/spreadsheets\/d\/e\/([\w-]+)/.exec(trimmed);
  if (published !== null) {
    return {
      csvUrl: `https://docs.google.com/spreadsheets/d/e/${published[1]}/pub?output=csv`,
      kind: 'published',
    };
  }

  const standard = /\/spreadsheets\/d\/([\w-]{20,})/.exec(trimmed);
  if (standard === null) {
    throw new SheetError('Could not find a sheet id in that link');
  }

  // The tab. Sits in the fragment when copied from the address bar, and
  // in the query string when copied from the sharing dialog.
  const gid = /[#&?]gid=(\d+)/.exec(trimmed)?.[1] ?? '0';

  return {
    csvUrl: `https://docs.google.com/spreadsheets/d/${standard[1]}/export?format=csv&gid=${gid}`,
    kind: 'standard',
  };
};

export const fetchSheetCsv = async (url: string): Promise<string> => {
  const target = parseSheetUrl(url);

  let response: Response;
  try {
    response = await fetch(target.csvUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'CaloVanCheck/1.0' },
    });
  } catch {
    throw new SheetError('Could not reach Google Sheets. Check the connection and try again.');
  }

  if (response.status === 404) {
    throw new SheetError('That sheet does not exist. Check the link.');
  }

  const body = await response.text();

  // A sheet that is not shared does not 403. Google answers with the
  // sign-in page at status 200, so the status alone cannot be trusted.
  const looksLikeHtml = body.trimStart().startsWith('<');

  if (response.status === 403 || looksLikeHtml) {
    throw new SheetError(
      target.kind === 'published'
        ? 'That published link is not readable. Republish the sheet and try again.'
        : 'This sheet is private. In Google Sheets open Share, set General access to "Anyone with the link", then try again. You can set it back to Restricted straight afterwards.',
    );
  }

  if (!response.ok) {
    throw new SheetError(`Google Sheets returned ${response.status}`);
  }
  if (body.trim() === '') {
    throw new SheetError('That sheet tab is empty');
  }

  return body;
};
