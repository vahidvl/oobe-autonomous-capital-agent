import crypto from 'node:crypto';
import type { AceConvictionResult } from '../oobe/aceMcp.js';
import type { PolicyDecision } from '../types.js';

export interface AuditProofPayload {
  readonly version: '1.0.0';
  readonly generatedAtMs: number;
  readonly intentHash: string;
  readonly aceConviction: AceConvictionResult;
  readonly policyDecision: PolicyDecision;
  readonly routeSummary: {
    readonly provider: 'Jupiter' | 'MultiHopper' | 'SAP_MCP';
    readonly inputMint: string;
    readonly outputMint: string;
    readonly amountIn: string;
    readonly expectedOut: string;
  };
  readonly explorerUrl: string;
}

export interface SignedAuditBundle {
  readonly payload: AuditProofPayload;
  readonly publicKeyPem: string;
  readonly signatureBase64: string;
}

export function createSignedAuditBundle(payload: AuditProofPayload): SignedAuditBundle {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const signatureBase64 = crypto.sign(null, data, privateKey).toString('base64');
  return { payload, publicKeyPem, signatureBase64 };
}

export function verifyAuditBundle(bundle: SignedAuditBundle): boolean {
  const data = Buffer.from(JSON.stringify(bundle.payload), 'utf8');
  const sig = Buffer.from(bundle.signatureBase64, 'base64');
  return crypto.verify(null, data, bundle.publicKeyPem, sig);
}

export function formatAuditMarkdown(bundle: SignedAuditBundle): string {
  const p = bundle.payload;
  return [
    '# OOBE Autonomous Capital Agent — Signed Audit Bundle',
    `- **Generated:** ${new Date(p.generatedAtMs).toISOString()}`,
    `- **Intent Hash:** \`${p.intentHash}\``,
    `- **Ace Data Cloud Conviction:** ${p.aceConviction.convictionScore}/100 (${p.aceConviction.regime}, receipt \`${p.aceConviction.receipt.receiptId}\`)`,
    `- **Policy Decision:** ${p.policyDecision.approved ? 'APPROVED' : 'DENIED'} (${p.policyDecision.reason})`,
    `- **Route:** ${p.routeSummary.provider} \`${p.routeSummary.inputMint}\` -> \`${p.routeSummary.outputMint}\` (${p.routeSummary.amountIn} -> ${p.routeSummary.expectedOut})`,
    `- **Explorer:** ${p.explorerUrl}`,
    `- **Ed25519 Signature:** \`${bundle.signatureBase64.slice(0, 32)}...\``,
  ].join('\n');
}
