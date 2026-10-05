import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, FileText, TableProperties, CodeXml, Languages, TriangleAlert } from 'lucide-react';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';
import PageMeta from '../../components/PageMeta';
import { downloadCreditStatement, statementRenditionUrl, downloadStatementRendition } from '../../api/creditStatements';
import './StatementAccessibleView.css';

// Accessible renditions of an issued statement document.
// Route (to be registered by the app; see the workstream report):
//   /statements/:documentId/accessible?product=oxsteed|restaurant&restaurantId=&from=&to=&currencyCode=
// The product/period search params feed the CSV fallback, which uses the
// existing statement export endpoints. PDF and HTML renditions come from the
// statementRenditions router (RENDITION_MOUNT in api/creditStatements.js).
const STATEMENT_LANGUAGES = [
  { code: 'en', native: 'English' },
  { code: 'es', native: 'Español' },
  { code: 'fr', native: 'Français' },
  { code: 'ht', native: 'Kreyòl' },
  { code: 'ar', native: 'العربية' },
];

async function readErrorCode(error) {
  try {
    const data = error?.response?.data;
    if (data instanceof Blob) return JSON.parse(await data.text())?.code || null;
    if (typeof data === 'string') return JSON.parse(data)?.code || null;
    return data?.code || null;
  } catch {
    return null;
  }
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export default function StatementAccessibleView() {
  const { t, i18n } = useTranslation('credit');
  const { documentId } = useParams();
  const [searchParams] = useSearchParams();
  const uiLanguage = (i18n.resolvedLanguage || i18n.language || 'en').split(/[-_]/)[0];
  const text = (key, options = {}) => t(`statements.accessible.${key}`, options);
  const [statementLanguage, setStatementLanguage] = useState(() =>
    STATEMENT_LANGUAGES.some((entry) => entry.code === uiLanguage) ? uiLanguage : 'en');
  const [pdfState, setPdfState] = useState('idle');
  const [csvState, setCsvState] = useState('idle');
  const [glyphNotice, setGlyphNotice] = useState(null);
  const noticeRef = useRef(null);
  const requestRef = useRef(null);

  const product = searchParams.get('product') === 'restaurant' ? 'restaurant' : 'oxsteed';
  const restaurantId = searchParams.get('restaurantId');
  const csvParams = {
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    currencyCode: searchParams.get('currencyCode'),
    language: statementLanguage,
  };
  const csvReady = Boolean(csvParams.from && csvParams.to && csvParams.currencyCode
    && (product === 'oxsteed' || restaurantId));

  // When the unsupported-script notice appears, move focus to it so screen
  // reader users land on the recovery options immediately.
  useEffect(() => {
    if (glyphNotice) noticeRef.current?.focus({ preventScroll: false });
  }, [glyphNotice]);

  useEffect(() => () => {
    requestRef.current?.abort();
  }, []);

  const validDocument = typeof documentId === 'string' && documentId.length > 0;

  async function downloadPdf() {
    if (!validDocument || pdfState === 'busy') return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setPdfState('busy');
    setGlyphNotice(null);
    try {
      const response = await downloadStatementRendition(documentId, statementLanguage, { signal: controller.signal });
      const blob = response.data;
      const contentType = String(response.headers?.['content-type'] || blob?.type || '').split(';')[0].trim().toLowerCase();
      if (!(blob instanceof Blob) || !blob.size || contentType !== 'application/pdf') throw new Error('Invalid rendition download');
      triggerBlobDownload(blob, `accessible-statement-${statementLanguage}.pdf`);
      setPdfState('done');
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = await readErrorCode(error);
      if (code === 'statement_unsupported_glyph') {
        let serverNotice = null;
        try {
          const data = error?.response?.data;
          const payload = data instanceof Blob ? JSON.parse(await data.text()) : data;
          serverNotice = payload?.notice || null;
        } catch { serverNotice = null; }
        setGlyphNotice({ title: text('glyphTitle'), body: serverNotice || text('glyphBody') });
        setPdfState('glyph');
      } else {
        setPdfState('error');
      }
    }
  }

  async function downloadCsv() {
    if (!csvReady || csvState === 'busy') return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setCsvState('busy');
    try {
      const response = await downloadCreditStatement(product, restaurantId, 'csv', csvParams, { signal: controller.signal });
      const blob = response.data;
      const contentType = String(response.headers?.['content-type'] || blob?.type || '').split(';')[0].trim().toLowerCase();
      if (!(blob instanceof Blob) || !blob.size || !['text/csv', 'application/csv'].includes(contentType)) {
        throw new Error('Invalid CSV download');
      }
      triggerBlobDownload(blob, `${product}-statement-${csvParams.from}-${csvParams.to}-${csvParams.currencyCode}.csv`);
      setCsvState('done');
    } catch (error) {
      if (!controller.signal.aborted) setCsvState('error');
    }
  }

  const htmlUrl = validDocument ? statementRenditionUrl(documentId, statementLanguage, 'html') : null;
  const backTarget = product === 'restaurant' ? '/restaurant-credit/statements' : '/oxsteed-credit/statements';

  return (
    <div className="statement-accessible-shell" dir={i18n.dir(uiLanguage)}>
      <PageMeta title={text('title')} description={text('description')} noIndex />
      <Navbar />
      <main className="statement-accessible-page">
        <Link to={backTarget} className="sa-back">
          <ArrowLeft size={16} aria-hidden="true" />{text('backToStatements')}
        </Link>
        <header className="sa-header">
          <FileText size={30} aria-hidden="true" />
          <div>
            <h1>{text('title')}</h1>
            <p>{text('description')}</p>
          </div>
        </header>

        <fieldset className="sa-language">
          <legend><Languages size={16} aria-hidden="true" />{text('languageLabel')}</legend>
          <div className="sa-language-options" role="radiogroup" aria-label={text('languageLabel')}>
            {STATEMENT_LANGUAGES.map((entry) => (
              <label key={entry.code} className="sa-language-option">
                <input
                  type="radio"
                  name="statement-language"
                  value={entry.code}
                  checked={statementLanguage === entry.code}
                  onChange={() => {
                    setStatementLanguage(entry.code);
                    setGlyphNotice(null);
                    setPdfState('idle');
                  }}
                />
                <span lang={entry.code}>{entry.native}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="sa-status" role="status" aria-live="polite">
          {pdfState === 'busy' || csvState === 'busy' ? text('loading') : null}
          {pdfState === 'error' ? text('pdfError') : null}
        </div>

        {glyphNotice ? (
          <div className="sa-notice" role="alert" tabIndex={-1} ref={noticeRef} aria-labelledby="sa-glyph-title">
            <TriangleAlert size={22} aria-hidden="true" />
            <div>
              <h2 id="sa-glyph-title">{glyphNotice.title}</h2>
              <p>{glyphNotice.body}</p>
              <div className="sa-notice-actions">
                {htmlUrl ? (
                  <a className="sa-button" href={htmlUrl} target="_blank" rel="noreferrer">
                    {text('htmlAction')}
                  </a>
                ) : null}
                {csvReady ? (
                  <button type="button" className="sa-button" onClick={downloadCsv} disabled={csvState === 'busy'}>
                    {text('csvAction')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="sa-cards">
          <section className="sa-card" aria-labelledby="sa-pdf-title">
            <FileText size={26} aria-hidden="true" />
            <h2 id="sa-pdf-title">{text('pdfTitle')}</h2>
            <p>{text('pdfDescription')}</p>
            <button
              type="button"
              className="sa-button sa-primary"
              onClick={downloadPdf}
              disabled={!validDocument || pdfState === 'busy'}
              aria-busy={pdfState === 'busy'}
            >
              <Download size={16} aria-hidden="true" />
              {pdfState === 'busy' ? text('loading') : text('pdfAction')}
            </button>
          </section>

          <section className="sa-card" aria-labelledby="sa-html-title">
            <CodeXml size={26} aria-hidden="true" />
            <h2 id="sa-html-title">{text('htmlTitle')}</h2>
            <p>{text('htmlDescription')}</p>
            {htmlUrl ? (
              <a className="sa-button sa-primary" href={htmlUrl} target="_blank" rel="noreferrer">
                {text('htmlAction')}
                <span className="sa-visually-hidden">{text('openNewTab')}</span>
              </a>
            ) : (
              <button type="button" className="sa-button sa-primary" disabled>{text('htmlAction')}</button>
            )}
          </section>

          <section className="sa-card" aria-labelledby="sa-csv-title">
            <TableProperties size={26} aria-hidden="true" />
            <h2 id="sa-csv-title">{text('csvTitle')}</h2>
            <p>{text('csvDescription')}</p>
            <button
              type="button"
              className="sa-button sa-primary"
              onClick={downloadCsv}
              disabled={!csvReady || csvState === 'busy'}
              aria-busy={csvState === 'busy'}
            >
              <Download size={16} aria-hidden="true" />
              {csvState === 'busy' ? text('loading') : text('csvAction')}
            </button>
          </section>
        </div>

        <p className="sa-note">{text('renditionNote')}</p>
      </main>
      <Footer />
    </div>
  );
}
