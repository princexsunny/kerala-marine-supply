// The twelve Shalom ventures — the single source of truth for both the
// homepage cards and the individual venture pages.
//
// `roles` lists the vacancies each venture is hiring for; careers.html and
// the venture pages both render from it, so a role can never appear in one
// place and not the other.
//
// A note on what is and isn't in here: the descriptions, statuses and links
// are Kerala Marine Supply's own. The "how it earns" sections describe the
// SHAPE of each business (where revenue comes from, what the cost drivers
// are) — they deliberately contain no revenue, profit or market-size figures,
// because none have been supplied and inventing them for an investor-facing
// page would be indefensible. Add real numbers here when you have them.
window.KMS_VENTURES = [
  {
    slug: 'fishing-net-online',
    num: '01',
    roles: ['Online Store Executive', 'Packing & Dispatch Assistant'],
    photo: 'venture1',
    name: 'Shalom Fishing Net Online',
    status: 'Running now',
    icon: 'cart',
    summary: 'E-commerce platform for fishing nets and marine products — selling today.',
    link: { href: 'https://shalom-marine-nets.onrender.com/', label: 'Visit the store' },
    brief:
      'An online shop for nets, ropes, floats and marine hardware, built because buying gear in ' +
      'Trivandrum has meant travelling to a handful of merchants and taking whatever they stock. ' +
      'It is live and taking orders, which makes it the first of the twelve to prove the model.',
    opportunity:
      'Every working boat is a repeat customer: nets wear, ropes part, floats are lost. Demand is ' +
      'recurring rather than one-off, and the buyer is the same fisherman the rest of the group ' +
      'already serves. Because the store is online, it reaches beyond the handful of harbours a ' +
      'physical shop could cover, without a second premises.',
    model:
      'Retail margin on goods sold. The main cost drivers are stock, storage and delivery; the ' +
      'main lever is buying volume — the same purchasing that supplies the planned gear shop and ' +
      'the machine workshop.',
    jobs:
      'Order handling, packing and dispatch, plus stock control. As volume grows this is the ' +
      'natural home for storekeeping and inventory roles.',
    next:
      'Proves demand and builds the customer list that Shalom Fishing Gear (07) and Shalom Marine ' +
      'Spare Parts (10) will sell into, and gives the machine workshop a route to market.',
  },
  {
    slug: 'marine-machine-manufacturing',
    num: '02',
    roles: ['Hydraulics Technician', 'Machinist / Fitter', 'Assembly Technician'],
    photo: 'venture2',
    name: 'Shalom Marine Machine Manufacturing',
    status: 'Running now',
    icon: 'gear',
    summary: 'Power blocks, hydraulic winch, crane and anchor winches, net haulers, cranes, capstans — first machine built and working.',
    brief:
      'Deck machinery designed for the boats and nets actually used on this coast, rather than ' +
      'imported equipment that has to be adapted. The first machine is built and working, which ' +
      'is the difference between a prototype and a product.',
    opportunity:
      'Deck machinery is the equipment a working boat cannot do without and cannot easily ' +
      'improvise. Building it locally shortens both the lead time and the repair loop — the same ' +
      'workshop that made a winch can fix it, instead of the owner shipping it out of the district.',
    model:
      'Manufacture and sale of machines, with servicing and spares as recurring revenue behind ' +
      'each unit sold. Cost drivers are materials, fabrication labour and workshop capacity.',
    jobs:
      'Welding and fabrication, hydraulics, machining, assembly and quality control — the same ' +
      'trades the boat yard needs, which is why the two share a labour pool.',
    next:
      'The fabrication capability underpins Shalom Marine Engineering (09) and supplies the yard ' +
      'and the shipbuilding venture with parts that would otherwise be bought in.',
  },
  {
    slug: 'fisherman-finance',
    num: '03',
    roles: ['Software Support Executive', 'Field Trainer (Fishermen)'],
    photo: 'venture3',
    name: 'Shalom Fisherman Finance',
    status: 'Running now',
    icon: 'calc',
    summary: 'Income, expenses, crew wages, fuel costs, profit sharing and loan tracking — free to use.',
    link: { href: 'ledger-app.html', label: 'Open the calculator' },
    brief:
      'A daily calculator for a fishing boat: enter the catch and the day\'s costs, and it works ' +
      'out the crew share, the profit and the running balance. Given away free, because a good ' +
      'day at sea should not be lost to bad arithmetic.',
    opportunity:
      'Crew shares and loan repayments are where trust between an owner and a crew is won or ' +
      'lost. A tool that makes the split transparent is worth more as a relationship than as a ' +
      'product — it puts Shalom in front of boat owners daily, at no cost to them.',
    model:
      'Not a revenue line. It earns its keep as distribution: the fishermen who use it are the ' +
      'customers for fuel, gear, repair and the fish marketplace.',
    jobs: 'Software maintenance and support, handled in-house.',
    next:
      'The habit and the trust it builds are what make Shalom Fish Online (08) plausible — a ' +
      'marketplace only works if the fishermen already have a reason to open your app.',
  },
  {
    slug: 'boat-yard',
    num: '04',
    roles: ['Boat Yard Manager', 'Boat Yard Supervisor', 'Marine Mechanic', 'Marine Electrician', 'Fiberglass (FRP) Technician', 'Welder & Fabricator', 'Boat Maintenance Technician', 'Boat Cleaner & Detailer', 'Dock & Slipway Operator', 'Crane & Hoist Operator', 'Quality Control Inspector', 'Storekeeper / Inventory Executive', 'Safety (HSE) Officer', 'Yard Assistant / General Worker', 'Operations Coordinator'],
    photo: 'venture4',
    name: 'Shalom Boat Yard',
    status: 'Building now',
    icon: 'crane',
    summary: 'Repair, maintenance, dry docking, refitting and servicing — Chirayinkeezhu, 8 months in, licensing in process.',
    brief:
      'A full-service yard at Chirayinkeezhu: hauling out, hull and engine repair, refitting and ' +
      'routine servicing. Eight months into construction, with licensing in process.',
    opportunity:
      'There is no dedicated boat yard in Trivandrum today — vessels leave the district for every ' +
      'repair, losing fishing days to the journey as well as the work. A yard here converts that ' +
      'lost time into local trade, for a fleet of 150+ vessels in the immediate area.',
    model:
      'Charges for haul-out, labour and materials, plus scheduled maintenance contracts. Capacity ' +
      'is the constraint and the asset: slipway slots, covered space and skilled hands.',
    jobs:
      'The largest employer of the twelve — 15 open roles across management, supervision, marine ' +
      'mechanics and electricians, FRP technicians, welders, crane and slipway operators, quality ' +
      'control, stores, safety and general yard work.',
    next:
      'The yard is the keystone. It is what makes Shalom Shipbuilding (06) possible — building ' +
      'vessels needs the same slipway, sheds and trades as repairing them.',
  },
  {
    slug: 'marine-fuels',
    num: '05',
    roles: ['Fuel Station Supervisor', 'Fuel Pump Operator', 'Maintenance Technician'],
    photo: 'venture5',
    name: 'Shalom Marine Fuels',
    status: 'Building now',
    icon: 'fuel',
    summary: 'Bunkering, diesel supply, fuel storage and delivery — LOI sanctioned with Jio-bp.',
    brief:
      'A dedicated marine refuelling facility, with a letter of intent sanctioned with Jio-bp. ' +
      'Today boats in the area refuel by can, hiring two people to carry it.',
    opportunity:
      'Fuel is the largest running cost of a fishing boat and currently the most awkward to buy. ' +
      'Refuelling at the harbour removes both the labour of carrying it and the time lost doing ' +
      'so. It is also the most repeatable transaction in the group — every boat, every trip.',
    model:
      'Margin on volume supplied, with storage and delivery as the operational cost. Throughput ' +
      'matters more than price: the facility earns by serving the same fleet continuously.',
    jobs: 'Fuel station supervisor, pump operators and maintenance — 3 open roles.',
    next:
      'Daily fuel contact is the relationship that carries the rest of the group. It also funds ' +
      'and de-risks the yard build-out, which is why the two are being raised for together.',
  },
  {
    slug: 'shipbuilding',
    num: '06',
    roles: ['Production Manager', 'Naval Architect / Design Engineer', 'Boat Builder (FRP Technician)'],
    photo: 'venture6',
    name: 'Shalom Shipbuilding & Vessel Manufacturing',
    status: 'Next',
    icon: 'ship',
    summary: 'Design and manufacture of fishing vessels and commercial boats — FRP, steel and wooden.',
    brief:
      'Designing and building fishing vessels and commercial boats in FRP, steel and wood — the ' +
      'step beyond repairing them.',
    opportunity:
      'Trivandrum sends its repairs out of the district and buys its boats from elsewhere. A yard ' +
      'that can build as well as fix keeps both the work and the skills local, and gives owners a ' +
      'builder who will still be there when the boat needs servicing.',
    model:
      'Build contracts, with design and fit-out as separate lines. Long cycles and high value per ' +
      'unit, which is why it follows the yard rather than leading.',
    jobs: 'Production manager, naval architect / design engineer and boat builders — 3 open roles.',
    next:
      'Turns the group from a service business into a manufacturer, and gives the machine ' +
      'workshop and engineering arm a captive customer.',
  },
  {
    slug: 'fishing-gear',
    num: '07',
    roles: ['Retail Sales Executive', 'Wholesale Accounts Executive'],
    photo: 'venture7',
    name: 'Shalom Fishing Gear',
    status: 'Next',
    icon: 'hook',
    summary: 'Net shop, retail and wholesale — ropes, hooks, floats, accessories and safety equipment.',
    brief:
      'The physical counterpart to the online store: a gear shop selling retail and wholesale — ' +
      'ropes, hooks, floats, accessories and safety equipment.',
    opportunity:
      'Gear is bought in a hurry, often the night before a trip, and that is a purchase the ' +
      'internet cannot serve. A counter near the harbour captures the urgent buy; the online store ' +
      'captures the planned one.',
    model:
      'Retail and wholesale margin, sharing purchasing and stock with the online store so the ' +
      'same buying volume serves both.',
    jobs: 'Counter sales, stock handling and wholesale accounts.',
    next:
      'Completes the supply side, so a boat can be fuelled, repaired and re-equipped without ' +
      'leaving the district.',
  },
  {
    slug: 'fish-online',
    num: '08',
    roles: ['Marketplace Operations Executive', 'Quality Checker (Landing Centre)'],
    photo: 'venture8',
    name: 'Shalom Fish Online',
    status: 'Next',
    icon: 'fish',
    summary: 'Fishermen selling fresh fish direct to consumers, restaurants, hotels, exporters and wholesalers.',
    link: { href: 'https://shalom-fish.onrender.com', label: 'See the live build' },
    brief:
      'A marketplace putting fishermen in direct contact with consumers, restaurants, hotels, ' +
      'exporters and wholesalers. Two builds are already live.',
    opportunity:
      'The gap between what a fisherman is paid at the landing and what the fish sells for is the ' +
      'oldest problem on this coast. Shortening that chain raises the price at the boat without ' +
      'raising it at the table.',
    model:
      'Commission on transactions, with logistics as the enabling cost — which is why it pairs ' +
      'with the cold chain venture rather than standing alone.',
    jobs: 'Marketplace operations, buyer relationships and quality checking at the landing.',
    next:
      'Creates the demand signal the cold chain (11) and the export business (12) are built to ' +
      'serve.',
  },
  {
    slug: 'marine-engineering',
    num: '09',
    roles: ['Marine Engineer', 'Hydraulic Systems Technician'],
    photo: 'venture9',
    name: 'Shalom Marine Engineering',
    status: 'Next',
    icon: 'wrench',
    summary: 'Vessel modifications, machinery installation and hydraulic systems.',
    brief:
      'Modifying vessels, installing machinery and building hydraulic systems — the specialist ' +
      'work that sits above routine repair.',
    opportunity:
      'Every winch, crane and hauler the workshop builds has to be fitted and commissioned. Doing ' +
      'that in-house captures work that would otherwise go to outside contractors, and keeps the ' +
      'people who built the machine involved in installing it.',
    model:
      'Project and day-rate work, with higher margin than routine servicing because it depends on ' +
      'skill rather than capacity.',
    jobs: 'Marine engineers, hydraulics specialists and installation technicians.',
    next:
      'The technical depth that shipbuilding needs, and the reason a customer chooses this yard ' +
      'over a cheaper one.',
  },
  {
    slug: 'marine-spare-parts',
    num: '10',
    roles: ['Spare Parts Counter Executive', 'Inventory Controller'],
    photo: 'venture10',
    name: 'Shalom Marine Spare Parts',
    status: 'Next',
    icon: 'prop',
    summary: 'Engines, pumps, propellers, electrical systems and accessories.',
    brief:
      'Engines, pumps, propellers, electrical systems and accessories — the parts counter behind ' +
      'the yard.',
    opportunity:
      'A yard without parts waits. Holding stock turns a repair that would take a week of ordering ' +
      'into one that takes a day, which is the whole value of having a yard nearby in the first ' +
      'place.',
    model:
      'Parts margin, plus the repair labour it unlocks. Working capital is tied up in stock, so ' +
      'the range follows what the yard actually consumes.',
    jobs: 'Parts sales, stores and inventory control.',
    next:
      'Removes the main source of delay in the yard, and gives the online store and gear shop a ' +
      'higher-value product line.',
  },
  {
    slug: 'cold-chain',
    num: '11',
    roles: ['Cold Store Operator', 'Refrigerated Transport Driver'],
    photo: 'venture11',
    name: 'Shalom Cold Chain & Seafood Logistics',
    status: 'Future',
    icon: 'truck',
    summary: 'Cold storage, ice supply, refrigerated transport and seafood logistics.',
    brief:
      'Cold storage, ice supply and refrigerated transport — the infrastructure that keeps a ' +
      'catch worth what it was when it was landed.',
    opportunity:
      'Value is lost between the boat and the buyer whenever the cold chain breaks. Ice and ' +
      'refrigerated transport protect the price the marketplace is trying to raise, and serve ' +
      'every boat regardless of who they sell to.',
    model:
      'Storage fees, ice sales and haulage charges — utilisation-driven, and steadier than the ' +
      'catch itself because it earns on other people\'s fish too.',
    jobs: 'Cold store operations, drivers and logistics coordination.',
    next:
      'Without it, export is not credible. This is the venture that turns a local trade into one ' +
      'that can ship.',
  },
  {
    slug: 'seafood-export',
    num: '12',
    roles: ['Processing Supervisor', 'Export Documentation Executive'],
    photo: 'venture12',
    name: 'Shalom Seafood Export',
    status: 'Future',
    icon: 'export',
    summary: 'Processing, packaging and export.',
    brief:
      'Processing, packaging and export — the last step, where the catch leaves Kerala at its ' +
      'highest value.',
    opportunity:
      'Export is where the margin sits, and it is the only part of the chain that needs every ' +
      'other part working first: a reliable supply from the marketplace, a cold chain to protect ' +
      'it, and processing to meet buyers\' standards.',
    model:
      'Export margin on processed product. Capital-intensive and compliance-heavy, which is why ' +
      'it is deliberately last.',
    jobs: 'Processing floor, quality assurance, packaging, documentation and export compliance.',
    next:
      'Completes the chain: from the net on the boat to the box on the ship, every step owned ' +
      'locally.',
  },
];
