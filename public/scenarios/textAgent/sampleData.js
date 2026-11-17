// Corvid Mobile is a made-up mobile network. Every name and number here is invented.
export const companyName = "Corvid Mobile";

export const accounts = [
  {
    accountId: "CM-482113",
    name: "Sam Whitaker",
    phone: "2061351246",
    plan: "Unlimited Plus",
    balanceDue: "$68.40",
    lastBillDate: "2026-09-15",
    lastPaymentDate: "2026-08-20",
    lastPaymentAmount: "$45.00",
    status: "Active",
    address: { street: "1234 Pine Street", city: "Seattle", state: "WA", zip: "98101" },
    lastBillDetails: {
      basePlan: "$45.00",
      internationalCalls: "$14.20",
      dataOverage: "$8.00",
      taxesAndFees: "$1.20",
      notes: "Higher than usual because of calls to Portugal on 2 and 9 September, and 2 GB of data overage.",
    },
  },
];

export const policyDocs = [
  {
    name: "family-plan",
    content: "The family plan allows up to 5 lines on one account. All lines share one data pool. Each line after the first gets 10 percent off. All lines must be on the same account.",
  },
  {
    name: "promotions",
    content: "The Autumn Unlimited offer gives 20 percent off Unlimited Plus for the first 6 months on new lines activated by 30 November 2026. Refer a friend gives a 50 dollar bill credit to both people after 60 days of active service, up to 5 credits per account. Offers can't be combined.",
  },
  {
    name: "international-calling",
    content: "Calls to other countries cost 0.25 dollars a minute on standard plans. The World Pass add-on is 10 dollars a month and covers 300 minutes to 60 countries, including Portugal, Spain, Mexico and Canada. It can be added at any time and is prorated for the first month.",
  },
  {
    name: "data-overage",
    content: "Plans with a data cap charge 4 dollars per extra gigabyte. Unlimited Plus has no overage charges in the US; overage on Unlimited Plus only applies to data used abroad without a travel pass.",
  },
  {
    name: "billing-disputes",
    content: "Customers can dispute a charge within 60 days of the bill date. A credit for a charge found to be wrong appears on the next bill. Payment plans are available for balances over 100 dollars.",
  },
];

export const stores = [
  { name: "Corvid Mobile Pike Street", address: "1501 Pike Street, Seattle, WA 98101", zip: "98101", hours: "9 to 8 every day", phone: "206 555 0182" },
  { name: "Corvid Mobile Capitol Hill", address: "410 Broadway East, Seattle, WA 98102", zip: "98102", hours: "10 to 7, closed Sundays", phone: "206 555 0147" },
  { name: "Corvid Mobile Bellevue Square", address: "575 Bellevue Square, Bellevue, WA 98004", zip: "98004", hours: "10 to 9 every day", phone: "425 555 0133" },
];
