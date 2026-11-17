// Quillon Energy is a made-up energy supplier. Every policy, price and number here is invented.
export const companyName = "Quillon Energy";

// Always-retrieved topics: on the session from the first turn, whatever the caller asks.
// A topic's `actions` say what to do about it, often which tool to call.
export const brief = [
  {
    name: "about-quillon",
    content: "Quillon Energy supplies electricity and gas to homes in Oregon and Washington. The phone line is open 8 am to 8 pm Monday to Saturday.",
  },
  {
    name: "gas-emergency",
    content: "A gas smell, a suspected leak or any danger is an emergency. Emergencies go to the utility's 24-hour emergency line, 1 800 555 0199, never to Quillon.",
    actions: "Give the emergency number straight away, before anything else, and tell the caller to leave the property if they smell gas.",
  },
  {
    name: "speak-to-a-person",
    content: "The customer team can see and change accounts. The help line can't.",
    actions: "If the caller asks for a person, or needs a change to their account, call transfer_call with reason SPEAK_TO or ACCOUNT_CHANGE. If the team is closed, offer requestCallback instead.",
  },
];

// The help center. A search returns the best matches, attached to the tool result.
export const articles = [
  {
    name: "submit-meter-reading",
    title: "Submitting a meter reading",
    content: "Customers can submit a reading in the app, on the website under Account then Meter readings, or by phone. Readings are due in the first 5 days of each month. Smart meters send readings automatically, so smart meter customers don't need to submit them.",
    actions: "If the caller wants to give a reading now, take the meter type and the digits on the meter, then call submitMeterReading.",
  },
  {
    name: "estimated-bills",
    title: "Missed a meter reading? Why bills are estimated",
    content: "If no reading arrives by the 5th, the bill is estimated from the same month last year. An estimated bill is marked with an E next to the usage. Submitting a reading at any time corrects the next bill, and any difference is credited or charged then.",
  },
  {
    name: "moving-home",
    title: "Moving home",
    content: "Tell Quillon at least 3 days before moving out, with the move date and a final meter reading on the day. The final bill arrives within 14 days. Customers moving within Oregon or Washington can take their plan with them; the new address is set up from the move-in date.",
  },
  {
    name: "payment-plans",
    title: "Payment plans and help paying",
    content: "Customers who are struggling can spread a balance over up to 12 months with no interest. The Quillon Care discount takes 20 percent off the unit rate for households on qualifying benefits. Neither affects credit scores.",
  },
  {
    name: "direct-debit",
    title: "Changing a direct debit",
    content: "The payment date can be any day from the 1st to the 28th. Changes take effect on the next bill. The monthly amount is reviewed every 6 months and adjusted if the account is more than 50 dollars in credit or debit.",
  },
  {
    name: "power-cut",
    title: "What to do in a power cut",
    content: "Power cuts are handled by the local network operator, not Quillon. In Oregon call 1 800 555 0141, in Washington call 1 800 555 0177. Outage maps are on the operator's website. Customers on the medical priority list get proactive updates.",
  },
  {
    name: "smart-meter-install",
    title: "Getting a smart meter",
    content: "Smart meters are free to install. Booking takes about 2 minutes in the app and the visit takes about an hour. Someone over 18 must be home and the meters must be accessible.",
  },
  {
    name: "tariffs",
    title: "Our tariffs",
    content: "Quillon Flex follows the market price and can change monthly with 30 days' notice. Quillon Fixed 12 locks the unit rate for 12 months with a 75 dollar exit fee per fuel. Quillon Green Fixed is the same as Fixed 12 with 100 percent renewable electricity, at about 4 percent more.",
  },
  {
    name: "complaints",
    title: "Making a complaint",
    content: "Complaints can be made by phone, email or in the app. Quillon acknowledges a complaint within 2 business days and aims to resolve it within 15. If it isn't resolved in 8 weeks, the customer can go to the state utility commission.",
  },
];
