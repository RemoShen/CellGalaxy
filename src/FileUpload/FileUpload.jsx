import React, { useState, useEffect, useCallback } from "react";
import "./FileUpload.css";

export default function FileUpload({ onRefresh = async () => {} }) {
  const [status, setStatus] = useState({ zarr: false, csv: false, raw: false, feat: false });
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState({ zarr: false, csv: false, raw: false, feat: false });
  const [open, setOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/upload/status?ts=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        setStatus({ zarr: false, csv: false, raw: false, feat: false });
        return;
      }
      const data = await res.json();
      setStatus({
        zarr: Boolean(data?.zarr),
        csv: Boolean(data?.csv),
        raw: Boolean(data?.raw),
        feat: Boolean(data?.feat),
      });
    } catch (err) {
      console.error("status fetch failed", err);
      setStatus({ zarr: false, csv: false, raw: false, feat: false });
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // close menu on outside click
  useEffect(() => {
    const onDocClick = (e) => {
      if (!open) return;
      if (e.target.closest(".upload-menu") || e.target.closest(".upload-main-btn")) return;
      setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  const handleFileUpload = async (fileType, file) => {
    if (!file) return;
    setBusy(true);
    setProcessing(prev => ({ ...prev, [fileType]: true }));
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/upload/${fileType}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        console.log(`${fileType} file uploaded successfully`);
        
        // If it's a CSV file, show processing status
        if (fileType === 'csv') {
          // Wait for a while to let user see processing status
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        await fetchStatus();
        await onRefresh();
      } else {
        console.error(`${fileType} file upload failed:`, response.statusText);
      }
    } catch (error) {
      console.error(`${fileType} file upload error:`, error);
    } finally {
      setBusy(false);
      setProcessing(prev => ({ ...prev, [fileType]: false }));
    }
  };

  const handleFileSelect = (fileType) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = fileType === 'zarr'
      ? '.zarr,.zip,.zarr.zip'
      : (fileType === 'feat' ? '.npy' : '.csv');
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        handleFileUpload(fileType, file);
      }
    };
    input.click();
  };

  const handleClear = async (fileType) => {
    setBusy(true);
    try {
      const response = await fetch(`/upload/${fileType}`, { method: 'DELETE' });
      if (response.ok) {
        console.log(`${fileType} file cleared`);
        await fetchStatus();
        await onRefresh();
      } else {
        console.error(`${fileType} file clear failed:`, response.statusText);
      }
    } catch (error) {
      console.error(`${fileType} file clear error:`, error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {(processing.csv || processing.zarr || processing.raw || processing.feat) && (
        <div className="fullscreen-processing-overlay">
          <div className="processing-content">
            <div className="processing-spinner"></div>
            {processing.csv && <div className="processing-text">uploading Raw Data...</div>}
            {processing.zarr && <div className="processing-text">uploading Image Data...</div>}
            {processing.raw && <div className="processing-text">uploading Meta Data...</div>}
            {processing.feat && <div className="processing-text">uploading Features...</div>}
          </div>
        </div>
      )}
      <div className="file-upload-section">
        <div className="upload-single">
          <button
            type="button"
            className="upload-main-btn"
            onClick={() => setOpen((v) => !v)}
            disabled={busy}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            {processing.csv || processing.zarr || processing.raw || processing.feat ? 'Uploading...' : 'Upload'}
          </button>
          {open && (
            <div className="upload-menu" role="menu">
              <div className="upload-menu-item" role="menuitem">
                <button className="upload-menu-action" onClick={() => { setOpen(false); handleFileSelect('zarr'); }} disabled={busy || status.zarr}>
                  Zarr Image (zip)
                </button>
                <button
                  className={`upload-menu-clear${status.zarr ? ' has-file' : ''}`}
                  onClick={() => handleClear('zarr')}
                  disabled={busy}
                  title="Clear Zarr"
                  aria-label="Clear Zarr"
                />
              </div>
              <div className="upload-menu-item" role="menuitem">
                <button className="upload-menu-action" onClick={() => { setOpen(false); handleFileSelect('csv'); }} disabled={busy || status.csv}>
                  Raw Data (csv)
                </button>
                <button
                  className={`upload-menu-clear${status.csv ? ' has-file' : ''}`}
                  onClick={() => handleClear('csv')}
                  disabled={busy}
                  title="Clear CSV"
                  aria-label="Clear CSV"
                />
              </div>
              <div className="upload-menu-item" role="menuitem">
                <button className="upload-menu-action" onClick={() => { setOpen(false); handleFileSelect('feat'); }} disabled={busy || status.feat}>
                  Features (npy)
                </button>
                <button
                  className={`upload-menu-clear${status.feat ? ' has-file' : ''}`}
                  onClick={() => handleClear('feat')}
                  disabled={busy}
                  title="Clear Features"
                  aria-label="Clear Features"
                />
              </div>
              <div className="upload-menu-item" role="menuitem">
                <button className="upload-menu-action" onClick={() => { setOpen(false); handleFileSelect('raw'); }} disabled={busy || status.raw}>
                  Meta Data (csv)
                </button>
                <button
                  className={`upload-menu-clear${status.raw ? ' has-file' : ''}`}
                  onClick={() => handleClear('raw')}
                  disabled={busy}
                  title="Clear Raw"
                  aria-label="Clear Raw"
                />
              </div>
            </div>
          )}
        </div>
    </div>
    </>
  );
}
