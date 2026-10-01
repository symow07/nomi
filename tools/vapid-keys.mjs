#!/usr/bin/env node
/**
 * G5b — a fresh key pair for alerts on the owner's phone (web push, RFC 8292).
 *
 * Run it on your own machine, then paste the two lines into the Railway
 * service `nomi` as variables yourself (with VAPID_SUBJECT, e.g.
 * `mailto:alerts@nomidoes.com`) and redeploy:
 *
 *   node tools/vapid-keys.mjs
 *
 * It prints the private key to your terminal and nowhere else: nothing is
 * written to a file or sent anywhere. Changing the pair later stops every
 * phone's alerts until each turns them on again from "Alerts on your phone".
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-65);
const d = privateKey.export({ format: 'jwk' }).d;
console.log(`VAPID_PUBLIC_KEY=${raw.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${d}`);
