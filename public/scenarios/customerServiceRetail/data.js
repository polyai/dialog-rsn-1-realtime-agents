// Larkspur Cycles is a made-up bike shop. Every name, order and number here is invented.
export const companyName = "Larkspur Cycles";

export const customers = [
  { phone: "5552014477", first_name: "Jordan", last_name: "Okafor", date_of_birth: "1988-03-14", zip: "94110" },
  { phone: "5559081234", first_name: "Priya", last_name: "Raman", date_of_birth: "1993-11-02", zip: "97214" },
];

export const orders = {
  "5552014477": [
    {
      order_id: "LC-30418",
      order_date: "2026-09-12",
      delivered_date: "2026-09-16",
      items: [
        { item_id: "B-221", item_name: "Fernway 2 gravel bike", category: "bike", price_usd: 1349, condition_reported: "ridden twice" },
        { item_id: "H-105", item_name: "Aero commuter helmet", category: "helmet", price_usd: 89, condition_reported: "unopened" },
      ],
    },
    {
      order_id: "LC-29170",
      order_date: "2026-07-03",
      delivered_date: "2026-07-08",
      items: [{ item_id: "A-310", item_name: "Saddle bag, 1.2 litre", category: "accessory", price_usd: 34, condition_reported: "used" }],
    },
  ],
  "5559081234": [
    {
      order_id: "LC-30655",
      order_date: "2026-09-28",
      delivered_date: "2026-10-01",
      items: [{ item_id: "E-020", item_name: "Tallis e-bike, size M", category: "e-bike", price_usd: 2899, condition_reported: "frame scratched on arrival" }],
    },
  ],
};

export const sales = [
  { item_id: "B-240", type: "bike", name: "Fernway 3 gravel bike", retail_price_usd: 1699, sale_price_usd: 1444, sale_discount_pct: 15 },
  { item_id: "B-118", type: "bike", name: "Citrine city bike", retail_price_usd: 749, sale_price_usd: 599, sale_discount_pct: 20 },
  { item_id: "H-110", type: "helmet", name: "Trailhead MIPS helmet", retail_price_usd: 129, sale_price_usd: 97, sale_discount_pct: 25 },
  { item_id: "L-042", type: "lights", name: "Beacon 800 front light", retail_price_usd: 79, sale_price_usd: 59, sale_discount_pct: 25 },
  { item_id: "A-077", type: "accessory", name: "Waterproof pannier pair", retail_price_usd: 119, sale_price_usd: 95, sale_discount_pct: 20 },
];

// The returns policy, as knowledge topics: the model answers from these and the page shows
// which ones it cited.
export const policy = [
  { name: "returns-window", content: "Most items can be returned within 30 days of delivery for a full refund. Bikes and e-bikes can be returned within 30 days if they have been ridden for less than 25 miles and have no damage caused by the rider." },
  { name: "returns-condition", content: "Helmets must be unopened to be returned, for safety reasons. Accessories must be unused and in their original packaging. Used accessories cannot be returned unless they are faulty." },
  { name: "damaged-on-arrival", content: "Anything that arrives damaged or faulty can be returned or replaced at no cost within 60 days of delivery, whatever its condition. The customer should describe the damage; photos help but are not required." },
  { name: "refund-timing", content: "Refunds go back to the original payment method within 5 business days of the return being received. Larkspur pays for return shipping on bikes and on anything damaged or faulty; otherwise a 9 dollar return label is deducted." },
  { name: "return-process", content: "Once a return is approved, the customer receives a text message with a prepaid return label and drop-off instructions within one hour. Bikes are collected from the customer's door by our courier." },
];
