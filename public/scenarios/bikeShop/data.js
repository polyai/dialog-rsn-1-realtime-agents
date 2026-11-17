// Larkspur Cycles is a made-up bike shop. Every name, order and number here is invented.
export const companyName = "Larkspur Cycles";

// Dates are relative to today, so the returns windows behave the same whenever you run it.
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export const customers = [
  { phone: "5552014477", first_name: "Jordan", last_name: "Okafor", date_of_birth: "1988-03-14", zip: "94110" },
  { phone: "5559081234", first_name: "Priya", last_name: "Raman", date_of_birth: "1993-11-02", zip: "97214" },
];

export const orders = {
  "5552014477": [
    {
      order_id: "LC-30418",
      order_date: daysAgo(16),
      delivered_date: daysAgo(12),
      items: [
        { item_id: "B-221", item_name: "Fernway 2 gravel bike", category: "bike", price_usd: 1349 },
        { item_id: "H-105", item_name: "Aero commuter helmet", category: "helmet", price_usd: 89 },
      ],
    },
    {
      order_id: "LC-29170",
      order_date: daysAgo(65),
      delivered_date: daysAgo(60),
      items: [{ item_id: "A-310", item_name: "Saddle bag, 1.2 litre", category: "accessory", price_usd: 34 }],
    },
  ],
  "5559081234": [
    {
      order_id: "LC-30655",
      order_date: daysAgo(12),
      delivered_date: daysAgo(9),
      items: [{ item_id: "E-020", item_name: "Tallis e-bike, size M", category: "e-bike", price_usd: 2899 }],
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

// The returns policy, in words. check_return applies it in code, and returns the topics it
// used as knowledge, so the agent can explain the decision and the page shows the citation.
export const policy = [
  { name: "returns-window", content: "Most items can be returned within 30 days of delivery for a full refund. Bikes and e-bikes can be returned within 30 days if they have been ridden for less than 25 miles and have no damage caused by the rider." },
  { name: "returns-condition", content: "Helmets must be unopened to be returned, for safety reasons. Accessories must be unused and in their original packaging. Used accessories cannot be returned unless they are faulty." },
  { name: "damaged-on-arrival", content: "Anything that arrives damaged or faulty can be returned or replaced at no cost within 60 days of delivery, whatever its condition. The customer should describe the damage; photos help but are not required." },
  { name: "refund-timing", content: "Refunds go back to the original payment method within 5 business days of the return being received. Larkspur pays for return shipping on bikes and on anything damaged or faulty; otherwise a 9 dollar return label is deducted." },
  { name: "return-process", content: "Once a return is approved, the customer receives a text message with a prepaid return label and drop-off instructions within one hour. Bikes are collected from the customer's door by our courier." },
];

// Always-retrieved topics: on the session from the first turn. `actions` say what to do.
export const topics = [
  {
    name: "store-hours",
    content: "Larkspur Cycles sells online and from two stores: Valencia Street in San Francisco, open 10 to 7 every day, and Hawthorne Boulevard in Portland, open 10 to 6, closed Mondays. The phone team works 8 to 6 Pacific, Monday to Saturday.",
  },
  {
    name: "returns",
    content: "Customers can return or exchange most things they bought from Larkspur. Returns need the order, so the caller must be verified first.",
    actions: "Once the caller is verified and wants to return or exchange something, call start_return straight away.",
  },
  {
    name: "sale",
    content: "There's a sale on selected bikes, helmets, lights and accessories. Anyone can buy, verified or not, but a checkout link is texted to a verified customer's number only.",
    actions: "When the caller asks what's on sale or wants to buy something, call lookup_sales for names and prices. Mention two or three items at most, then ask what kind of riding they do. When they choose, read back the item and its sale price, and once they agree, call send_checkout_link.",
  },
  {
    name: "speak-to-a-person",
    content: "The team can help with anything the agent can't, including complaints.",
    actions: "If the caller asks for a person, is upset, or wants something you can't do, call transfer_call with the matching reason.",
  },
];
