/**
 * The uploads from this browser (useUploads().uploads): one row each, the name above a state line, Retry and Cancel at
 * fixed places (off with a tip when they do not apply), and a 4px bar along the bottom.
 */
import React from 'react';
import { SmallButton } from '../discover/shared';
import { useNotify, errorText } from '../ui';
import { fmtBytes } from './importApi';
import './import.css';

function stateLine(u) {
  const sent = fmtBytes(u.sentBytes || 0);
  const total = fmtBytes(u.totalBytes || 0);
  switch (u.status) {
    case 'waiting': return `waiting · ${u.totalFiles} files, ${total}`;
    case 'uploading': return `${sent} of ${total} · batch ${Math.min((u.currentBatch ?? 0) + 1, u.totalBatches)} of ${u.totalBatches}`;
    case 'handing-over': return 'handing over to the server';
    case 'importing':
      // After the moves the server's progress restarts for each later stage, so those say their own name
      if (u.jobStage === 'hashing') return `importing on the server · hashing ${u.jobTotal ? Math.round(((u.jobDone || 0) / u.jobTotal) * 100) : 0}%`;
      if (u.jobStage === 'checking duplicates') return 'importing on the server · checking duplicates';
      return u.jobTotal
        ? `importing on the server · ${u.jobDone || 0} of ${u.jobTotal}`
        : 'waiting on the server';
    case 'failed': return `failed: ${u.error || 'it did not work'} · ${sent} of ${total} on the server`;
    default: return '';
  }
}

function share(u) {
  if (u.status === 'importing' && (u.jobStage === 'hashing' || u.jobStage === 'checking duplicates')) return 1;
  if (u.status === 'importing') return u.jobTotal ? (u.jobDone || 0) / u.jobTotal : 0;
  if (u.status === 'handing-over') return 1;
  return u.totalBytes ? (u.sentBytes || 0) / u.totalBytes : 0;
}

function cancelTip(u) {
  if (u.status === 'handing-over') return 'Wait a moment: handing over';
  if (u.status === 'importing') return 'The server is importing it: see Jobs';
  return null;
}

export default function UploadRows({ uploads, retryUpload, cancelUpload }) {
  const notify = useNotify();
  if (!uploads?.length) return null;
  return (
    <div className="im-rows">
      {uploads.map(u => {
        const failed = u.status === 'failed';
        const line = stateLine(u);
        const width = `${Math.round(Math.max(0, Math.min(1, share(u))) * 1000) / 10}%`;
        const noCancel = cancelTip(u);
        return (
          <div key={u.id} className={`im-row${failed ? ' failed' : ''}`}>
            <div className="im-row-main">
              <div className="im-row-name" title={u.sourceLabel && u.sourceLabel !== u.name ? `${u.name} · from "${u.sourceLabel}"` : u.name}>{u.name}</div>
              <div className="im-row-state" title={line}>{line}</div>
            </div>
            <SmallButton
              tip={failed ? undefined : 'Only a failed upload can be retried'}
              disabled={!failed}
              onClick={() => { Promise.resolve(retryUpload(u.id)).catch(err => notify({ message: errorText(err), severity: 'error' })); }}
            >
              Retry
            </SmallButton>
            <SmallButton danger tip={noCancel || undefined} disabled={!!noCancel} onClick={() => cancelUpload(u.id)}>
              Cancel
            </SmallButton>
            <div className="im-track" aria-hidden><div className="im-fill" style={{ width }} /></div>
          </div>
        );
      })}
    </div>
  );
}
