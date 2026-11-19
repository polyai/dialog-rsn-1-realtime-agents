// Maison Lumiere is PolyAI's demo restaurant, the same one as in the playground on poly.ai.
// Every name, price and number here is made up.
export const restaurantName = "Maison Lumiere";
export const restaurantPhone = "(555) 941-7260";

// Always-retrieved topics: on the session from the first turn, whatever the caller asks.
// A topic's `actions` say what to do about it, often which tool to call.
export const always = [
  {
    name: "location-and-hours",
    content: `Maison Lumiere is an upscale French-Japanese restaurant at 12 Rue des Lumieres, Kensington, with the entrance through the courtyard. Phone ${restaurantPhone}. Open every evening: seatings run from 5 pm, and the last is at 9:45 pm. Dress code is smart casual, with no sportswear or trainers.`,
  },
  {
    name: "seating",
    content: "Three areas: the main dining room; the terrace, for parties of up to six, which is unheated and closes at 10 pm; and the bar, for one or two. Dogs are welcome on the terrace only.",
    actions: "If the guest asks for an area, pass it to check_availability as area: main, terrace or bar.",
  },
  {
    name: "booking-policies",
    content: "Tables are held for 15 minutes past the booking time. There is a 48-hour cancellation policy, and late cancellations are charged 75 pounds a person. Parties of 7 to 12 need a card to hold the booking, which the restaurant takes by phone afterwards. Corkage is 45 pounds a bottle, at most two bottles a table. If the evening is full there is a wait list, and mid-week cancellations are common.",
    actions: "Mention the one policy that matters for the booking being made, such as the card hold for a party of 7 to 12, once, when you read the booking back.",
  },
  {
    name: "large-parties-and-events",
    content: "Parties of more than 12 go through the Maitre d', Ghislaine Trepanier-Vaillancourt, who arranges the Salon Ephemere private dining room, for up to 14, and full buyouts, for up to 42.",
    actions: "For a party of more than 12, a private room or a buyout, offer to put the guest through to Ghislaine, and if they agree, call transfer_call with reason EVENTS.",
  },
  {
    name: "dietary-needs",
    content: "A vegetarian or vegan tasting menu needs 48 hours' notice. Most courses can be made gluten free. All 14 major allergens are tracked. Halal and kosher preparation can't be guaranteed.",
    actions: "Put any allergy or dietary need in the booking's notes, and say the kitchen will be told.",
  },
  {
    name: "existing-bookings",
    content: "Changing or cancelling an existing booking, and taking payments, is done by the reservations team, not on this line.",
    actions: "Offer to put the guest through to reservations, and if they agree, call transfer_call with reason CHANGE_BOOKING.",
  },
];

// Searched topics: the guide's longer sections. search_guide finds them, and they ride on its
// output as poly_knowledge, so the session only carries the ones the call needs.
export const guide = [
  {
    name: "menu-lumiere",
    content: "There are two seasonal tasting menus and no a la carte. Menu Lumiere is seven courses at 145 pounds a person: a dashi veloute of Jerusalem artichoke with yuzu kosho; chawanmushi with black truffle and shiitake; hand-dived Orkney scallop carpaccio with shiso, ponzu and oscietra caviar; a saffron and kombu bouillabaisse with langoustine and red mullet; roast Gressingham duck with tsukemono and a sansho jus; Neal's Yard cheeses or yuzu-wasabi sorbet; and a matcha mille-feuille with hojicha cream.",
  },
  {
    name: "menu-omakase",
    content: "Menu Omakase is twelve courses at 215 pounds a person, chosen daily by the head sushi chef, Haruki Tsujimura, from the day's fish. Recent courses include otoro tartare, uni chawanmushi, salt-grilled nodoguro, and A5 Miyazaki wagyu on a hot stone. The Chef's Table is two seats at the kitchen pass, for the Omakase only, by request: put it in the booking's notes.",
  },
  {
    name: "wine",
    content: "Over 400 wines, focused on Burgundy, the Rhone and boutique Japanese wineries. Highlights: from Burgundy, Domaine de la Romanee-Conti; from the Rhone, Chateau Rayas; from Japan, Grace Wine's Koshu from Yamanashi. The head sommelier, Ciaran O Muircheartaigh, is happy to suggest pairings on the night.",
  },
  {
    name: "sake-and-spirits",
    content: "Sake and Japanese spirits include Dassai 23, Juyondai Honmaru, Hakkaisan, Hibiki 21 and Yamazaki 18. The sake sommelier is Anais Lefevre-Joubert.",
  },
  {
    name: "cocktails",
    content: "Cocktails include the Umami Martini, made with kombu-infused olive brine, the Sakura Spritz, and a Yuzu Highball.",
  },
  {
    name: "staff",
    content: "Executive Chef and owner Nikola Mrksic, said NEE-koh-lah MUR-ksitch, trained at Le Cordon Bleu in Paris and spent five years in Kyoto. Head sushi chef Haruki Tsujimura prepares the Omakase. The pastry sous chef is Aisling Ni Dhonnabhain. Head sommelier Ciaran O Muircheartaigh; sake sommelier Anais Lefevre-Joubert. The Maitre d' is Ghislaine Trepanier-Vaillancourt.",
  },
];
