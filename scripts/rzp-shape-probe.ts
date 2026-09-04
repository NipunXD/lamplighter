import 'dotenv/config';
import Razorpay from 'razorpay';
const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
const pays: any = await rzp.payments.all({ count: 3 } as any);
const captured = pays.items.find((p: any) => p.status === 'captured');
console.log('a captured payment:', { id: captured?.id, order_id: captured?.order_id, status: captured?.status, amount: captured?.amount, method: captured?.method, captured: captured?.captured });
if (captured?.order_id) {
  const op: any = await rzp.orders.fetchPayments(captured.order_id);
  console.log('orders.fetchPayments shape:', { count: op.count, keys: Object.keys(op), first: op.items?.[0] && { id: op.items[0].id, status: op.items[0].status, amount: op.items[0].amount, method: op.items[0].method } });
  const one: any = await rzp.payments.fetch(captured.id);
  console.log('payments.fetch shape:', { id: one.id, status: one.status, amount: one.amount, method: one.method, order_id: one.order_id });
}
