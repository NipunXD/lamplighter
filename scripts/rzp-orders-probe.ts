import 'dotenv/config';
import Razorpay from 'razorpay';
const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const all: any = await rzp.orders.all({ count: 100 } as any);
console.log('orders visible (max 100 shown):', all.count, 'first id', all.items?.[0]?.id);
for (let i = 0; i < 3; i++) {
  try { const o: any = await rzp.orders.create({ amount: 1000 + i, currency: 'INR', receipt: `probe_${Date.now()}_${i}`, notes: { app: 'lamplighter', purpose: 'quota probe' } }); console.log('order ok', o.id, o.status); }
  catch (e: any) { console.log('order FAILED', e.statusCode, e?.error?.code, e?.error?.description); }
  await sleep(700);
}
const one: any = await rzp.orders.all({ count: 1 } as any);
try { const pays: any = await rzp.orders.fetchPayments(one.items[0].id); console.log('fetchPayments ok, count', pays.count); } catch (e: any) { console.log('fetchPayments failed', e?.error?.description ?? e?.message); }
