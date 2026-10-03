/* -------------------------------------------------------------------------
   Astro Vetro - static catalogue
   -------------------------------------------------------------------------

   The products, services, articles and testimonials the storefront renders,
   held in-process so the site is fully functional before MongoDB exists.

   This is not invented filler. Every record below is the real Astro Vetro
   catalogue, lifted from the backend seed data
   (astrovetro/server/seed/seed.js), so what renders today is exactly what the
   database will hold once it is connected. The Mongo provider replaces this
   file's reader; no record needs rewriting.

   Image handling is deliberately empty. The seed references per-product
   files such as /product-amethyst-ring.png, but those live in the backend
   public directory and are NOT served by this project. Attaching some other
   crystal photograph to every product would imply a picture of that item
   that does not exist, so images are left empty and the card renderer falls
   back to its own placeholder. When the real photography is added here,
   populate images[] and the cards pick it up with no other change.

   Read-only by design. Nothing here mutates, and nothing pretends to: a
   storefront that accepted orders into an in-memory array would be lying to
   the customer about whether their order was placed.
   ------------------------------------------------------------------------- */

export const products = [
  {
    "_id": "p1",
    "slug": "amethyst-ring",
    "name": "Amethyst Ring",
    "category": "ring",
    "price": 888,
    "images": [],
    "shortDescription": "Raw amethyst set in hammered sterling silver.",
    "description": "A beautifully raw amethyst crystal, bezel-set in hand-hammered sterling silver. Each stone is individually selected for its depth of colour and natural clarity.",
    "intentions": [
      "Calm",
      "Intuition",
      "Balance"
    ],
    "rating": 5,
    "reviewCount": 47,
    "availability": true,
    "featured": true,
    "stone": "Amethyst",
    "metal": "Sterling Silver"
  },

  {
    "_id": "p2",
    "slug": "raw-black-tourmaline-ring",
    "name": "Raw Black Tourmaline Ring",
    "category": "ring",
    "price": 999,
    "images": [],
    "shortDescription": "Protective raw tourmaline in oxidised silver.",
    "description": "Raw black tourmaline in a bold, oxidised silver setting. One of the most grounding and protective stones in the mineral world.",
    "intentions": [
      "Protection",
      "Grounding",
      "Clarity"
    ],
    "rating": 5,
    "reviewCount": 61,
    "availability": true,
    "featured": true,
    "stone": "Black Tourmaline",
    "metal": "Oxidised Silver"
  },

  {
    "_id": "p3",
    "slug": "rose-quartz-bracelet",
    "name": "Rose Quartz Bracelet",
    "category": "bracelet",
    "price": 555,
    "images": [],
    "shortDescription": "Pale rose beads with a gold-filled clasp.",
    "description": "Smooth, pale rose quartz beads strung on a durable cord with a gold-filled clasp. Worn close to the skin, a gentle daily reminder of softness.",
    "intentions": [
      "Love",
      "Self-care",
      "Compassion"
    ],
    "rating": 5,
    "reviewCount": 83,
    "availability": true,
    "featured": true,
    "stone": "Rose Quartz",
    "metal": "Gold-filled"
  },

  {
    "_id": "p4",
    "slug": "labradorite-pendant",
    "name": "Labradorite Pendant",
    "category": "pendant",
    "price": 1299,
    "images": [],
    "shortDescription": "Teardrop labradorite with blue-green flash.",
    "description": "A teardrop labradorite with a remarkable blue-green labradorescent flash, set in a hand-formed sterling silver bezel. Each stone shows a different play of light.",
    "intentions": [
      "Intuition",
      "Transformation",
      "Spiritual Growth"
    ],
    "rating": 5,
    "reviewCount": 39,
    "availability": true,
    "featured": true,
    "stone": "Labradorite",
    "metal": "Sterling Silver"
  },

  {
    "_id": "p5",
    "slug": "citrine-tower",
    "name": "Citrine Tower",
    "category": "tower",
    "price": 1499,
    "images": [],
    "shortDescription": "Polished natural citrine tower, warm amber glow.",
    "description": "A polished natural citrine tower, warm amber light moving through the stone. Placed in a space, it brings a quality of lightness and optimism.",
    "intentions": [
      "Abundance",
      "Focus",
      "Confidence"
    ],
    "rating": 5,
    "reviewCount": 28,
    "availability": true,
    "featured": true,
    "stone": "Citrine",
    "metal": null
  },

  {
    "_id": "p6",
    "slug": "pyrite-cluster",
    "name": "Pyrite Cluster",
    "category": "cluster",
    "price": 799,
    "images": [],
    "shortDescription": "Geometric golden pyrite cluster, bold and grounding.",
    "description": "A raw pyrite cluster with bold geometric cubic formations. A striking piece for a desk or shelf — its reflective metallic surfaces create their own quiet drama.",
    "intentions": [
      "Abundance",
      "Manifestation",
      "Confidence"
    ],
    "rating": 4.8,
    "reviewCount": 52,
    "availability": true,
    "featured": true,
    "stone": "Pyrite",
    "metal": null
  },

  {
    "_id": "p7",
    "slug": "clear-quartz-point",
    "name": "Clear Quartz Point",
    "category": "tower",
    "price": 699,
    "images": [],
    "shortDescription": "A faceted clear quartz point, crisp and amplifying.",
    "description": "A flawless-looking natural clear quartz point. Known for amplifying intention and thought, it pairs with any practice and works as a beautiful object on its own.",
    "intentions": [
      "Focus",
      "Manifestation",
      "Clarity"
    ],
    "rating": 4.9,
    "reviewCount": 34,
    "availability": true,
    "featured": false,
    "stone": "Clear Quartz",
    "metal": null
  },

  {
    "_id": "p8",
    "slug": "black-obsidian-tumble",
    "name": "Black Obsidian Tumble",
    "category": "tumble",
    "price": 349,
    "images": [],
    "shortDescription": "Glossy black obsidian, smooth in the palm.",
    "description": "A palm-sized black obsidian tumble. Said to draw out what does not serve you, it is a grounding, honest stone to keep on a desk or carry in a pocket.",
    "intentions": [
      "Protection",
      "Grounding"
    ],
    "rating": 4.9,
    "reviewCount": 41,
    "availability": true,
    "featured": false,
    "stone": "Black Obsidian",
    "metal": null
  },

  {
    "_id": "p9",
    "slug": "moonstone-pendant",
    "name": "Moonstone Pendant",
    "category": "pendant",
    "price": 1199,
    "images": [],
    "shortDescription": "Milky moonstone with a soft blue sheen.",
    "description": "A round moonstone cabochon with the delicate blue adularescence the stone is loved for, in a fine sterling silver setting. A gemstone associated with new beginnings.",
    "intentions": [
      "Love",
      "Intuition",
      "New Beginnings"
    ],
    "rating": 5,
    "reviewCount": 22,
    "availability": true,
    "featured": false,
    "stone": "Moonstone",
    "metal": "Sterling Silver"
  },

  {
    "_id": "p10",
    "slug": "carnelian-pendant",
    "name": "Carnelian Pendant",
    "category": "pendant",
    "price": 799,
    "images": [],
    "shortDescription": "Immersive orange carnelian, activating and warm.",
    "description": "A smooth carnelian cabochon with that signature translucent orange glow. Associated with courage, creativity and activating your own personal power.",
    "intentions": [
      "Confidence",
      "Creativity"
    ],
    "rating": 4.8,
    "reviewCount": 19,
    "availability": true,
    "featured": false,
    "stone": "Carnelian",
    "metal": "Sterling Silver"
  },

  {
    "_id": "p11",
    "slug": "tigers-eye-bracelet",
    "name": "Tiger's Eye Bracelet",
    "category": "bracelet",
    "price": 499,
    "images": [],
    "shortDescription": "Golden-brown tiger's eye with a silky chatoyancy.",
    "description": "Rounded tiger's eye beads with the stone's characteristic shimmering bands of gold and brown. Steady, practical and quietly confident.",
    "intentions": [
      "Grounding",
      "Focus",
      "Confidence"
    ],
    "rating": 4.9,
    "reviewCount": 37,
    "availability": true,
    "featured": false,
    "stone": "Tiger's Eye",
    "metal": "Gold-filled"
  },

  {
    "_id": "p12",
    "slug": "lepidolite-tumble",
    "name": "Lepidolite Tumble",
    "category": "tumble",
    "price": 299,
    "images": [],
    "shortDescription": "Lilac lepidolite — a stone of transition and ease.",
    "description": "A soft lilac lepidolite tumble with a gentle shimmer. High in lithium, it is associated with calm, sleep and steadying the mind during times of change.",
    "intentions": [
      "Calm",
      "Transition"
    ],
    "rating": 4.9,
    "reviewCount": 16,
    "availability": true,
    "featured": false,
    "stone": "Lepidolite",
    "metal": null
  },
];

export const services = [
  {
    "_id": "s1",
    "name": "Monthly Tarot Reading",
    "slug": "monthly-tarot-reading",
    "type": "tarot",
    "duration": 35,
    "price": 555,
    "shortDescription": "A personal reading for the month ahead.",
    "description": "A focused, personal tarot reading designed around the questions, decisions and reflections occupying your mind right now. Conducted online, at a time that suits you.",
    "image": null,
    "available": true,
    "featured": true,
    "format": "online",
    "availability": true
  },

  {
    "_id": "s2",
    "name": "Deep Dive Reading",
    "slug": "deep-dive-reading",
    "type": "tarot",
    "duration": 60,
    "price": 999,
    "shortDescription": "An hour of focused personal guidance.",
    "description": "For questions that need more space. An hour-long session that allows for a more thorough exploration of where you are and where you are moving.",
    "image": null,
    "available": true,
    "featured": false,
    "format": "online",
    "availability": true
  },

  {
    "_id": "s3",
    "name": "Relationship Spread",
    "slug": "relationship-spread",
    "type": "tarot",
    "duration": 45,
    "price": 777,
    "shortDescription": "A considered look at connection and compatibility.",
    "description": "A gentle, honest reading focused on the relationships in your life — romantic, family, friendship — and the patterns you bring to connection.",
    "image": null,
    "available": true,
    "featured": false,
    "format": "online",
    "availability": true
  },
];

export const testimonials = [
  {
    "_id": "t1",
    "name": "Ananya R.",
    "location": "Bangalore",
    "type": "reading",
    "productOrService": "Monthly Tarot Reading",
    "content": "I didn't come in expecting anything specific — just a sense that something was off. The reading gave me language for it. Not predictions, but perspective. That's exactly what I needed.",
    "rating": 5,
    "featured": true,
    "verified": true
  },

  {
    "_id": "t2",
    "name": "Meera K.",
    "location": "Mumbai",
    "type": "product",
    "productOrService": "Rose Quartz Bracelet",
    "content": "The bracelet is genuinely beautiful — the quality of the stones, the way it sits on the wrist. I've had several people ask about it. But more than that, I find myself more considered when I wear it.",
    "rating": 5,
    "featured": true,
    "verified": true
  },

  {
    "_id": "t3",
    "name": "Priya S.",
    "location": "Delhi",
    "type": "product",
    "productOrService": "Amethyst Ring",
    "content": "The ring arrived beautifully packaged and immediately felt like something I'd chosen carefully myself. The stone is exactly as it appeared — rich, dark, real. Worn it every day since.",
    "rating": 5,
    "featured": true,
    "verified": true
  },

  {
    "_id": "t4",
    "name": "Rohan M.",
    "location": "Pune",
    "type": "reading",
    "productOrService": "Deep Dive Reading",
    "content": "I was sceptical for most of the first ten minutes. Then she said something that stopped me. An hour later I had a much clearer picture of what I'd been avoiding.",
    "rating": 5,
    "featured": false,
    "verified": true
  },

  {
    "_id": "t5",
    "name": "Neha B.",
    "location": "Hyderabad",
    "type": "product",
    "productOrService": "Tiger's Eye Bracelet",
    "content": "Bought the tiger’s eye for my brother before an important interview. He refuses to take it off now. The quality genuinely exceeded what the photos suggested.",
    "rating": 5,
    "featured": false,
    "verified": true
  },
];

export const articles = [
  {
    "_id": "a1",
    "slug": "how-to-choose-your-first-crystal",
    "title": "How to choose your first crystal",
    "category": "crystal-guide",
    "excerpt": "The most common question we receive. Our approach: start with intention, not aesthetics. Here's how to find the stone that will actually mean something to you.",
    "content": "The single most common question we receive is also the simplest to answer badly: \"Which crystal should I start with?\"\n\nStores love to answer with the biggest or most colourful piece on the shelf. We would rather you answer it yourself — which is not as hard as it sounds. Here is the process we use with friends, family and customers.\n\nBegin with a feeling, not a name. \"I want to feel calmer.\" \"I keep second-guessing myself.\" \"Something just feels heavy.\" Any of these is a vastly better starting point than \"I want a crystal for X\".\n\nThe right next step is to name the intention in plain language. Protection, calm, focus, confidence, love, abundance, willingness to change. Whatever it is, write it down.\n\nNow look at the stones associated with that intention. The connection between a stone and a feeling is not scientific — it is human, cultural, and personal. But it is remarkably stable across traditions, which tells us something about how these associations work in practice.\n\nFinally, the most underrated step: hold the stone. A crystal you notice in a photograph is nice. A crystal you want to keep picking up, put in your pocket, or leave beside your laptop is the right one. Allow your own small, quiet attraction to do most of the work.\n\nAnd if you choose a stone and it means nothing to you personally — that is fine too. Set it aside and try another. A collection is not a commitment ceremony. It is a conversation you keep having with yourself.",
    "readingTime": 5,
    "author": "AstroVetro",
    "featured": true,
    "tags": [
      "beginners",
      "crystal guide",
      "intention"
    ],
    "image": "/hero-crystal.png",
    "publishedAt": "2026-01-01"
  },

  {
    "_id": "a2",
    "slug": "how-to-cleanse-and-care-for-your-crystals",
    "title": "How to cleanse and care for your crystals",
    "category": "care",
    "excerpt": "A practical guide to keeping your stones in good condition — from light and water sensitivity to simple cleansing rituals that take less than five minutes.",
    "content": "Crystals are minerals, and minerals have preferences. Caring for them is mostly a matter of knowing what each stone can tolerate and what it cannot.\n\nFirst, the basics that apply to every piece in the AstroVetro collection. Keep stones away from direct, prolonged sunlight — many stones, amethyst and rose quartz among them, will fade over time in harsh light. Store them somewhere they will not be knocked around, and wipe them with a soft, dry cloth after handling.\n\nWater is the area people get wrong most often. Salt-water cleansing is traditional, but a significant number of stones — including argonite, selenite and pyrite — can be damaged or discoloured by it. As a rule, when in doubt, do not soak. A few stones, like selenite, should barely meet water at all.\n\nA safer, five-minute cleansing ritual: hold the stone under fresh, running water for a few seconds while setting your intention, dry it gently, and leave it in moonlight overnight. Moonlight is gentle, and almost every stone tolerates it.\n\nYou can also cleanse by intention alone. Simply rest the stone somewhere clean and quiet for a day or two, hold it, and allow it to return to neutral. Many people find this works as well as anything more involved.\n\nWhen in doubt about a specific stone, ask before you buy — that is exactly the kind of question we love being asked.",
    "readingTime": 4,
    "author": "AstroVetro",
    "featured": true,
    "tags": [
      "care",
      "cleansing",
      "ritual"
    ],
    "image": "/product-rose-quartz-bracelet.png",
    "publishedAt": "2026-01-02"
  },

  {
    "_id": "a3",
    "slug": "understanding-black-tourmaline",
    "title": "Understanding Black Tourmaline",
    "category": "crystal-guide",
    "excerpt": "One of the most frequently asked-about stones in the AstroVetro collection. What it is, where it comes from, and why people are so drawn to carrying it.",
    "content": "Ask anyone who works with crystals which stone they reach for on a hard day, and black tourmaline is often the first name that comes up.\n\nBlack tourmaline is a boron-silicate mineral that forms in long, deeply striated crystals. The stones you will see in the collection range from glossy, dark columns to raw fragments, and they are typically mined in Brazil, Africa, and parts of Asia.\n\nThe association it carries is protection — but protection in a specific sense. Not a wall, so much as a groundedness. People who wear it describe feeling less pulled around by other people's moods, less rattled by environments they cannot control, and more able to notice what is actually happening around them.\n\nIt also pairs well with lightness. Many people keep black tourmaline near their door or desk specifically because it is a grounding stone, one that does not ask anything of you. It does not sparkle, it does not demand attention. It simply sits there, steady.\n\nPractical notes: black tourmaline is durable, safe in water as long as the piece is set in jewellery that permits it, and benefits from being placed in soil or under running water when you feel it needs resetting.\n\nIf you have never carried a stone before and the idea of protection is what keeps recurring, black tourmaline is a reasonable, honest first choice.",
    "readingTime": 6,
    "author": "AstroVetro",
    "featured": true,
    "tags": [
      "black tourmaline",
      "protection",
      "crystal guide"
    ],
    "image": "/product-tourmaline-ring.png",
    "publishedAt": "2026-01-03"
  },
];

export default { products, services, testimonials, articles };
