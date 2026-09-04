import 'dotenv/config';
import Razorpay from 'razorpay';
const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all: any = await rzp.paymentLink.all({ count: 100 } as any);
const links: any[] = all.payment_links ?? [];
const byStatus: Record<string, number> = {};
for (const l of links) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
console.log('total links visible:', links.length, byStatus);
const ours = links.filter((l) => l.notes?.app === 'lamplighter' && l.status === 'created');
console.log('lamplighter links still open:', ours.length);
// probe the error shape with an obviously invalid request
try { await rzp.paymentLink.create({ amount: 0, currency: 'INR', description: 'probe' } as any); } catch (e: any) { console.log('error shape keys:', Object.keys(e), 'statusCode=', e.statusCode, 'error=', JSON.stringify(e.error).slice(0, 200)); }
// cancel our open links and see whether creation works again
let cancelled = 0;
for (const l of ours) { try { await rzp.paymentLink.cancel(l.id); cancelled++; await sleep(600); } catch (e: any) { console.log('cancel failed', l.id, e?.error?.description ?? e?.message); } }
console.log('cancelled', cancelled);
await sleep(1000);
try {
  const pl: any = await rzp.paymentLink.create({ amount: 10000, currency: 'INR', description: 'quota probe after cancel', notes: { app: 'lamplighter', purpose: 'probe' }, notify: { sms: false, email: false }, customer: { name: 'Probe', email: 'probe@example.test', contact: '+919000090000' } } as any);
  console.log('create after cancel: OK', pl.id, pl.status);
  await sleep(600); await rzp.paymentLink.cancel(pl.id); console.log('probe link cancelled');
} catch (e: any) { console.log('create after cancel FAILED:', e.statusCode, e?.error?.description ?? e?.message); }
const after: any = await rzp.paymentLink.all({ count: 100 } as any);
const bs: Record<string, number> = {}; for (const l of after.payment_links ?? []) bs[l.status] = (bs[l.status] ?? 0) + 1;
console.log('after:', bs);
