// Operating plans, shown on a venture's own page under its write-up.
//
// Keyed by venture slug, so a venture without a plan simply doesn't get the
// section. venture.html renders whatever is here through one generic drawer —
// nothing about FISHKO is hardcoded into the page.
//
// A word on what these numbers are. Every figure below is a TARGET or a
// WORKED EXAMPLE from the plan documents, not a result. The source documents
// are unusually careful about this — they say "example only", "hypothetical
// example only", and "hypotheses until measured with real customers" — and
// that caution is carried through here rather than quietly dropped. Presenting
// a plan's assumptions as achieved trading would be the easiest way to lose an
// investor's trust the moment they asked a follow-up question.
window.KMS_PLANS = {

  'fish-online': {
    brand: {
      name: 'FISHKO',
      logo: 'fishko-logo.png',
      tagline: 'Fresh from harbour to home',
      strap: 'Cut at six. At your door by nine.',
    },
    intro:
      'FISHKO is the brand Shalom Fish Online trades under. The plan below is how it is ' +
      'being built: a small pilot proving the economics of a single day’s buying and ' +
      'selling, and only then the work of finding customers who come back.',
    caveat:
      'These are targets and working assumptions, not trading results. The figures marked as ' +
      'examples are illustrations of the method, not claims about what has been earned.',

    stages: [
      {
        label: 'Stage 1',
        title: 'The ₹1,000 pilot',
        aim:
          'Prove that a small amount of working capital can be turned into profitable fresh-fish ' +
          'sales, repeatedly, before any of it is scaled.',
        blocks: [
          {
            kind: 'table',
            title: 'Where the ₹1,000 goes',
            head: ['', 'Limit'],
            rows: [
              ['Fish purchase', '₹650 – ₹750'],
              ['Ice', '₹50 – ₹100'],
              ['Packaging', '₹50 – ₹100'],
              ['Harbour, loading, travel', '₹50'],
              ['Cleaning', 'Nil at first — family handles it'],
              ['Emergency reserve', '₹100'],
            ],
            note:
              'The rule is not to spend the whole ₹1,000 on fish. The reserve is what covers ' +
              'a price move, more ice than expected, or a repair.',
          },
          {
            kind: 'steps',
            title: 'The buying decision, every morning',
            items: [
              { t: 'Check', d: 'Freshness, how much has landed, what the harbour is asking, and what demand there is for it.' },
              { t: 'Work out the ceiling', d: 'Expected selling price, less the profit required, less cleaning, ice, packaging, transport and an allowance for waste. That figure is the most that can be paid.' },
              { t: 'Decide', d: 'At or under the ceiling, buy. Slightly over, or demand uncertain, buy a small quantity. Well over, or poor demand, do not buy at all.' },
            ],
            note:
              'The question is never "what fish do I want today". It is "what is available at an ' +
              'unusually good price this morning that people here will actually buy".',
          },
          {
            kind: 'prose',
            title: 'Why profit is not price minus price',
            text:
              'Net profit is what remains after the fish, the cleaning, the ice, the packaging, ' +
              'the transport, the delivery and the fish that did not sell. Cleaning loss alone ' +
              'can remove an apparent margin: a kilo bought is not a kilo sold.',
          },
          {
            kind: 'table',
            title: 'A worked example, per kilo',
            head: ['', '₹'],
            rows: [
              ['Expected selling price', '450'],
              ['Cleaning', '20'],
              ['Ice', '10'],
              ['Packaging', '10'],
              ['Transport', '10'],
              ['Risk and wastage', '20'],
              ['Profit required', '100'],
              ['→ Maximum buying price', '≈ 280'],
            ],
            note:
              'An illustration of the arithmetic, not a price list. On those assumptions ₹240 ' +
              'is a buy, ₹275 is a careful buy, and ₹300 is not worth doing.',
          },
          {
            kind: 'steps',
            title: 'The morning',
            items: [
              { t: '4:30 – 5:00', d: 'Reach the harbour and see what has come in.' },
              { t: '5:00 – 6:00', d: 'Watch supply, prices and quality. Talk to brokers. Do not rush to buy.' },
              { t: '≈ 6:00', d: 'Choose the fish and the quantity, against the orders already taken and the ceiling price.' },
              { t: '6:00 – 7:00', d: 'Home — five minutes from the harbour.' },
              { t: '7:00 – 8:00', d: 'Clean and cut.' },
              { t: '8:00 – 8:30', d: 'Pack and label.' },
              { t: '8:30 onward', d: 'Local delivery, in slots.' },
            ],
          },
          {
            kind: 'list',
            title: 'What Stage 1 does not spend on',
            items: [
              'Advertising', 'Large stock', 'A permanent employee', 'A wide delivery area',
              'Twenty varieties of fish', 'Freezers and infrastructure', 'Elaborate packaging',
            ],
          },
        ],
      },

      {
        label: 'Stage 2',
        title: 'Customers who come back',
        aim:
          'Prove that local customers will pay FISHKO again — for fresh fish, fair pricing, ' +
          'clean handling and a delivery that arrives when it said it would.',
        blocks: [
          {
            kind: 'prose',
            title: 'What is actually being sold',
            text:
              'Not fish. The morning back. Going for fish means the trip, the fare, the hunt for ' +
              'the right one, the bargaining, carrying it home and then cleaning it. FISHKO takes ' +
              'that away and hands over something cleaned, cut and at the door.',
          },
          {
            kind: 'list',
            title: 'Who, within two to three kilometres',
            items: [
              'Middle-class families', 'Working couples', 'Busy homemakers', 'Elderly customers',
              'People without easy transport', 'Apartment residents', 'Anyone already buying fish regularly',
            ],
            note:
              'A 2 – 3 km radius to begin with. The customer worth having orders ₹250 – ₹500, ' +
              'several times a month — not the one who orders once.',
          },
          {
            kind: 'steps',
            title: 'From a stranger to a regular',
            items: [
              { t: 'Awareness', d: 'Neighbours, referrals, community and hotel partners.' },
              { t: 'WhatsApp or QR', d: 'The customer makes contact — never the other way round.' },
              { t: 'Today’s fish', d: 'What landed, the price, the cut options, the delivery slot.' },
              { t: 'Order', d: 'Fish, quantity, cut and slot. Under a minute on the website.' },
              { t: 'Clean, pack, deliver', d: 'Nearby orders batched into one morning route.' },
              { t: 'Feedback, then again', d: 'Quality, price and timing — then the repeat order, then the referral.' },
            ],
          },
          {
            kind: 'table',
            title: 'What gets measured, in order of importance',
            head: ['', 'Why it comes first'],
            rows: [
              ['Repeat customers', 'Proves the thing solves a real problem'],
              ['Orders per customer per month', 'Measures habit, not curiosity'],
              ['Average order value', 'Decides whether a delivery route pays'],
              ['Contribution per order', 'What is left for marketing, staff and profit'],
              ['Cost of winning a customer', 'Judged over repeat orders, never the first one'],
              ['Delivery cost per order', 'The number that kills route economics quietly'],
              ['Complaints and refunds', 'Trust, measured'],
              ['Total customers', 'Useful — and the least important of the eight'],
            ],
          },
          {
            kind: 'steps',
            title: 'Spending on customers, in that order',
            items: [
              { t: 'Free first', d: 'Family, neighbours, friends, existing contacts, local groups.' },
              { t: 'Then low cost', d: 'Referral partners, QR cards, permitted local promotion, referral rewards.' },
              { t: 'Paid last', d: 'Local Instagram and Facebook — only once repeat orders have proved themselves.' },
            ],
            note:
              'A customer who orders four times is worth four times one who orders once. ' +
              'Acquisition cost is judged against that, not against the first order.',
          },
          {
            kind: 'table',
            title: 'Hiring follows the workload',
            head: ['Orders a day', 'People'],
            rows: [
              ['0 – 10', 'Owner and family'],
              ['10 – 20', 'Part-time delivery; fixed staff kept at nil'],
              ['20 – 30', 'A cleaner and packer'],
              ['30 – 50', 'Dedicated delivery, plus the cleaner and packer'],
              ['50+', 'Buying, packing or customer service, as the economics allow'],
            ],
          },
          {
            kind: 'list',
            title: 'What Stage 2 will not do',
            items: [
              'Buy phone numbers or send WhatsApp messages nobody asked for',
              'Run large paid campaigns before the economics are known',
              'Put up stickers without permission',
              'Promise delivery at any hour',
              'Take small orders a long way',
              'Hire ahead of the workload',
              'Widen the area before the local route pays',
              'Manufacture demand with heavy discounts',
            ],
          },
          {
            kind: 'prose',
            title: 'Before it grows',
            text:
              'FISHKO handles and sells food, so the right food-business registration and local ' +
              'requirements are to be confirmed before any substantial expansion. Which category ' +
              'applies depends on what is actually being done — retail, cleaning, packing and ' +
              'delivery are not all the same thing.',
          },
        ],
      },
    ],

    docs: [
      { href: 'docs/FISHKO-Stage-1-Business-Plan.pdf', label: 'Stage 1 — business plan (PDF)' },
      { href: 'docs/FISHKO-Stage-2-Customer-Plan.pdf', label: 'Stage 2 — customer plan (PDF)' },
    ],
  },

};
