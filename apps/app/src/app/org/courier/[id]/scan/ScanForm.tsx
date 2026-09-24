'use client';

import { useState, useRef, useEffect } from 'react';

interface ScanFormProps {
  orgId: string;
  custodyCapable: boolean;
}

/**
 * Scan form component for the courier portal.
 * Handles barcode scanning and manual code entry.
 */
export function ScanForm({ orgId, custodyCapable }: ScanFormProps) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input on mount for barcode scanner
    inputRef.current?.focus();
  }, []);

  const handleScan = async (scannedCode: string) => {
    if (!scannedCode.trim()) {
      setError('Please enter a code');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/v1/parcel-orgs/me/labels/resolve?code=${encodeURIComponent(scannedCode)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Code not found or invalid');
      }

      const data = await response.json();
      setResult(data);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve code');
      setCode('');
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScan(code);
  };

  return (
    <div className="scan-form">
      <form onSubmit={handleSubmit} className="form">
        <div className="form-group">
          <label htmlFor="code-input">Parcel Code</label>
          <input
            ref={inputRef}
            id="code-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan or type a code..."
            disabled={loading}
            autoComplete="off"
            className="input"
          />
        </div>

        <button type="submit" disabled={loading || !code.trim()} className="btn-scan">
          {loading ? 'Scanning...' : 'Scan'}
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {result && (
        <div className="result-card">
          <h3>Code Found</h3>
          <div className="result-details">
            <div className="detail-row">
              <span className="detail-label">Code:</span>
              <span className="detail-value">{result.code}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label">State:</span>
              <span className="detail-value">{result.state}</span>
            </div>
            {result.itemDescription && (
              <div className="detail-row">
                <span className="detail-label">Description:</span>
                <span className="detail-value">{result.itemDescription}</span>
              </div>
            )}
            {result.destination && (
              <div className="detail-row">
                <span className="detail-label">Destination:</span>
                <span className="detail-value">{result.destination}</span>
              </div>
            )}
          </div>
          {!custodyCapable && (
            <div className="warning-banner">
              ⚠️ This login doesn't have custody capability. You cannot hold or hand over parcels.
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .scan-form {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .form-group label {
          font-weight: 500;
          color: #1f2937;
        }
        .input {
          padding: 0.75rem;
          font-size: 1rem;
          border: 1px solid #d1d5db;
          border-radius: 0.375rem;
          font-family: monospace;
          letter-spacing: 0.05em;
        }
        .input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        .input:disabled {
          background-color: #f3f4f6;
          color: #9ca3af;
          cursor: not-allowed;
        }
        .btn-scan {
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          font-weight: 600;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 0.375rem;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .btn-scan:hover:not(:disabled) {
          background-color: #2563eb;
        }
        .btn-scan:disabled {
          background-color: #d1d5db;
          cursor: not-allowed;
        }
        .error-message {
          padding: 1rem;
          background-color: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
          border-radius: 0.375rem;
        }
        .result-card {
          padding: 1rem;
          background-color: #f0fdf4;
          border: 1px solid #86efac;
          border-radius: 0.375rem;
        }
        .result-card h3 {
          margin: 0 0 1rem 0;
          color: #166534;
        }
        .result-details {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1rem;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          font-size: 0.875rem;
        }
        .detail-label {
          font-weight: 500;
          color: #166534;
        }
        .detail-value {
          color: #15803d;
          word-break: break-word;
        }
        .warning-banner {
          padding: 0.75rem;
          background-color: #fef3c7;
          border-left: 3px solid #f59e0b;
          border-radius: 0.25rem;
          font-size: 0.875rem;
          color: #92400e;
        }
      `}</style>
    </div>
  );
}
