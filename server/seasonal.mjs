// Month-by-month seasonal produce for Vancouver, BC. Used to bias the meal
// planner toward fresh local ingredients. Copied verbatim from Facey.

const SEASONAL = {
  1: {
    name: "January",
    produce: [
      "kale", "cabbage", "leeks", "parsnips", "carrots", "beets",
      "turnips", "celery root", "winter squash", "potatoes",
      "Brussels sprouts", "stored apples", "pears",
    ],
    notes: "Deep winter — root vegetables and brassicas dominate. Good for soups, stews, and roasts.",
  },
  2: {
    name: "February",
    produce: [
      "kale", "cabbage", "leeks", "parsnips", "carrots", "beets",
      "turnips", "celery root", "winter squash", "potatoes",
      "Brussels sprouts", "stored apples",
    ],
    notes: "Still winter storage season. Hearty, warming meals. Early greenhouse greens may appear.",
  },
  3: {
    name: "March",
    produce: [
      "kale", "cabbage", "leeks", "carrots", "beets", "potatoes",
      "overwintered spinach", "early radishes", "stored squash",
    ],
    notes: "Transition month — storage crops winding down, first spring greens emerging.",
  },
  4: {
    name: "April",
    produce: [
      "asparagus", "radishes", "spinach", "arugula", "green onions",
      "rhubarb", "lettuce", "early peas", "sorrel", "kale",
      "nettles", "fiddleheads",
    ],
    notes: "Spring arrives. Light, fresh flavours — asparagus and rhubarb are stars. Great for salads and light sautees.",
  },
  5: {
    name: "May",
    produce: [
      "asparagus", "radishes", "spinach", "arugula", "lettuce",
      "rhubarb", "peas", "green onions", "strawberries",
      "new potatoes", "bok choy", "spring onions", "herbs (chives, parsley, dill)",
    ],
    notes: "Spring peak. First strawberries, peas, and tender greens. Light grilling season starts.",
  },
  6: {
    name: "June",
    produce: [
      "strawberries", "peas", "lettuce", "spinach", "radishes",
      "green beans", "new potatoes", "zucchini", "beets",
      "cherries", "herbs (basil, cilantro, dill, mint)",
      "garlic scapes", "bok choy", "broccoli",
    ],
    notes: "Early summer bounty. Strawberries and cherries peak. Perfect for grilling and fresh salads.",
  },
  7: {
    name: "July",
    produce: [
      "cherries", "blueberries", "raspberries", "strawberries",
      "zucchini", "green beans", "cucumber", "tomatoes",
      "corn", "peppers", "beets", "carrots", "broccoli",
      "fresh herbs (basil, cilantro, dill)", "new potatoes",
    ],
    notes: "Peak summer. Berries exploding. Tomatoes and corn arriving. Best grilling and fresh eating season.",
  },
  8: {
    name: "August",
    produce: [
      "tomatoes", "corn", "peppers", "zucchini", "cucumber",
      "eggplant", "green beans", "blueberries", "blackberries",
      "peaches", "plums", "carrots", "beets", "onions",
      "garlic", "fresh herbs", "melons",
    ],
    notes: "Summer peak — everything is ripe. Tomatoes, stone fruit, and corn at their best. Abundance season.",
  },
  9: {
    name: "September",
    produce: [
      "tomatoes", "corn", "peppers", "eggplant", "zucchini",
      "apples", "pears", "plums", "grapes", "blackberries",
      "winter squash", "carrots", "beets", "onions", "garlic",
      "potatoes", "kale", "cauliflower", "broccoli",
    ],
    notes: "Harvest season. Summer and fall overlap — last tomatoes plus first squash and apples.",
  },
  10: {
    name: "October",
    produce: [
      "apples", "pears", "winter squash", "pumpkin", "kale",
      "Brussels sprouts", "cauliflower", "broccoli", "carrots",
      "beets", "potatoes", "onions", "leeks", "cabbage",
      "cranberries", "mushrooms (chanterelles, pine)",
    ],
    notes: "Fall harvest. Squash, apples, and wild mushrooms. Warm, roasted, and braised dishes.",
  },
  11: {
    name: "November",
    produce: [
      "kale", "cabbage", "Brussels sprouts", "winter squash",
      "carrots", "parsnips", "beets", "turnips", "potatoes",
      "leeks", "apples", "pears", "cranberries",
      "mushrooms (chanterelles)",
    ],
    notes: "Late fall into winter. Root vegetables and brassicas. Comfort food season — braises, soups, roasts.",
  },
  12: {
    name: "December",
    produce: [
      "kale", "cabbage", "Brussels sprouts", "winter squash",
      "carrots", "parsnips", "beets", "turnips", "potatoes",
      "leeks", "celery root", "stored apples", "pears",
    ],
    notes: "Winter storage season. Hearty root vegetables and brassicas. Holiday-friendly roasts and sides.",
  },
};

export function getSeasonalContext(date = new Date()) {
  const month = date.getMonth() + 1;
  const entry = SEASONAL[month];
  if (!entry) return "";

  const lines = [
    `It's ${entry.name} in Vancouver, BC. The following local produce is in season:`,
    entry.produce.join(", "),
    "",
    entry.notes,
    "",
    "Lean into seasonal ingredients where they fit naturally — don't force it, but prefer what's fresh and local over out-of-season imports.",
  ];
  return lines.join("\n");
}
