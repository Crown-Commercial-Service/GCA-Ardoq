function normaliseHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getField(row, ...aliases) {
  const normalisedRow = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normaliseHeader(key), value])
  );

  for (const alias of aliases) {
    const value = normalisedRow[normaliseHeader(alias)];
    if (value !== undefined && value !== null) return String(value);
  }

  return "";
}

function parseListish(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item).trim())
          .filter(Boolean)
          .join(", ");
      }
    } catch (error) {
      // Keep the original value when it is not valid JSON.
    }
  }

  return text;
}

function cleanSourceText(value, preserveNewlines = true) {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\{color(?::[^}]*)?\/\}/gi, "")
    .replace(/\{color(?::[^}]*)?\}/gi, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\\([\\()*_.-])/g, "$1");

  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());

  if (!preserveNewlines) {
    return lines.filter(Boolean).join(" ").trim();
  }

  const cleanedLines = [];
  let previousBlank = false;

  lines.forEach((line) => {
    if (line) {
      cleanedLines.push(line);
      previousBlank = false;
    } else if (cleanedLines.length && !previousBlank) {
      cleanedLines.push("");
      previousBlank = true;
    }
  });

  return cleanedLines.join("\n").trim();
}

function makeShortDescription(value, maximumLength = 165) {
  const text = cleanSourceText(value, false);
  if (!text) return "";

  const sentence = text.match(/^(.{20,165}?[.!?])(?:\s|$)/);
  if (sentence) return sentence[1].trim();
  if (text.length <= maximumLength) return text;

  const shortened = text
    .slice(0, maximumLength - 3)
    .replace(/\s+\S*$/, "")
    .replace(/[ ,;:-]+$/, "");

  return `${shortened || text.slice(0, maximumLength - 3)}...`;
}

function toBoolean(value) {
  return ["true", "yes", "1", "y"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function normaliseApplication(row) {
  const name = getField(row, "name", "Application Name").trim();
  const fullDescription = cleanSourceText(
    getField(row, "fullDescription", "Description"),
    true
  );
  const productManager = getField(
    row,
    "productManager",
    "Product Manager"
  ).trim();
  const suppliedShortDescription = getField(row, "shortDescription").trim();

  return {
    name,
    shortDescription:
      cleanSourceText(suppliedShortDescription, false) ||
      makeShortDescription(fullDescription),
    fullDescription,
    persona: parseListish(getField(row, "persona", "Persona")),
    hosting: parseListish(getField(row, "hosting", "Hosting Type")),
    directorate: parseListish(
      getField(row, "directorate", "Owning Directorate")
    ),
    productManager,
    pmUrl: getField(row, "pmUrl", "Product Manager URL").trim(),
    businessOwner: getField(
      row,
      "businessOwner",
      "Business/Technical Owner"
    ).trim(),
    businessOwnerUrl: getField(
      row,
      "businessOwnerUrl",
      "Business/Technical Owner URL"
    ).trim(),
    appUrl: getField(row, "appUrl", "Application URL").trim(),
    surveyUrl: getField(row, "surveyUrl", "Survey URL").trim(),
    digitalCapability: getField(
      row,
      "digitalCapability",
      "Digital Capability"
    ).trim(),
    supportingOrganisation: parseListish(
      getField(row, "supportingOrganisation", "Supporting Organisation")
    ),
    lifecyclePhase: parseListish(
      getField(row, "lifecyclePhase", "Lifecycle Phase")
    ),
    sourceWorksheet: getField(row, "sourceWorksheet").trim(),
    hasProductOwner:
      toBoolean(getField(row, "hasProductOwner")) || Boolean(productManager),
    letter:
      getField(row, "letter").trim() ||
      (name ? name.charAt(0).toUpperCase() : "#"),
  };
}

async function loadApplications() {
  const response = await fetch("data.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load data.json (${response.status})`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("data.json must contain a JSON array.");
  }

  return data
    .map(normaliseApplication)
    .filter((application) => application.name);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function splitMultiValue(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.replace("(Buyer)", "").trim())
    .filter(Boolean);
}

let applications = [];

const searchInput = document.getElementById("searchInput");
const personaFilter = document.getElementById("personaFilter");
const hostingFilter = document.getElementById("hostingFilter");
const directorateFilter = document.getElementById("directorateFilter");
const resultsGrid = document.getElementById("resultsGrid");
const resultsCount = document.getElementById("resultsCount");
const emptyState = document.getElementById("emptyState");

function getPersonaClass(personaString) {
  const firstPersona = splitMultiValue(personaString)[0];
  if (!firstPersona) return "persona-default";

  switch (firstPersona) {
    case "Buyer":
      return "persona-buyer";
    case "Staff":
      return "persona-staff";
    case "Supplier":
      return "persona-supplier";
    case "Citizen":
      return "persona-citizen";
    case "Central Government":
      return "persona-central-gov";
    case "Wider public sector":
      return "persona-wider-public";
    case "eSender":
      return "persona-esender";
    case "Admin":
      return "persona-admin";
    default:
      return "persona-default";
  }
}

function createLink(label, url) {
  const safeHref = safeUrl(url);
  const safeLabel = escapeHtml(label);
  return safeHref
    ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`
    : safeLabel;
}

function generateMetaHtml(application) {
  const productManager = application.productManager
    ? createLink(application.productManager, application.pmUrl)
    : "N/A";

  let businessOwner = "N/A";
  if (application.businessOwner) {
    const names = application.businessOwner.split(",").map((item) => item.trim());
    const urls = application.businessOwnerUrl
      .split(",")
      .map((item) => item.trim());

    businessOwner = names
      .map((name, index) => createLink(name, urls[index] || urls[0]))
      .join(", ");
  }

  const values = [
    ["Product Owner", productManager, true],
    ["Business Owner", businessOwner, true],
    ["Supporting Org", application.supportingOrganisation || "N/A"],
    ["Persona", application.persona || "N/A"],
    ["Hosting", application.hosting || "N/A"],
    ["Directorate", application.directorate || "N/A"],
    ["Lifecycle", application.lifecyclePhase || "N/A"],
  ];

  return values
    .map(
      ([label, value, containsHtml]) => `
        <div class="meta-row">
          <span class="meta-label">${escapeHtml(label)}</span>
          <span>${containsHtml ? value : escapeHtml(value)}</span>
        </div>
      `
    )
    .join("");
}

function createCard(application) {
  const card = document.createElement("article");
  card.className = `app-card ${getPersonaClass(application.persona)}`;

  const productTag = application.hasProductOwner
    ? '<span class="tag tag-product">PRODUCT</span>'
    : "";

  const title = createLink(application.name, application.appUrl);
  const description = escapeHtml(
    application.shortDescription || "No description available."
  );

  const fullDescription =
    application.fullDescription &&
    application.fullDescription !== application.shortDescription
      ? `
        <details class="description-details">
          <summary>Read full description</summary>
          <p>${escapeHtml(application.fullDescription)}</p>
        </details>
      `
      : "";

  const actions = [];
  const appUrl = safeUrl(application.appUrl);
  const surveyUrl = safeUrl(application.surveyUrl);

  if (appUrl) {
    actions.push(
      `<a href="${escapeHtml(appUrl)}" target="_blank" rel="noopener noreferrer" class="button button-secondary">View in Ardoq</a>`
    );
  }

  if (surveyUrl) {
    actions.push(
      `<a href="${escapeHtml(surveyUrl)}" target="_blank" rel="noopener noreferrer" class="button button-primary">Edit Data</a>`
    );
  }

  card.innerHTML = `
    <h3>${title}</h3>
    <p>${description}</p>
    ${fullDescription}
    <div class="tags">${productTag}</div>
    <div class="meta">${generateMetaHtml(application)}</div>
    <div class="card-actions">${actions.join("")}</div>
  `;

  return card;
}

function renderApplications() {
  const searchTerm = searchInput.value.trim().toLowerCase();
  const persona = personaFilter.value;
  const hosting = hostingFilter.value;
  const directorate = directorateFilter.value;

  const filtered = applications.filter((application) => {
    const matchesName = application.name.toLowerCase().includes(searchTerm);
    const matchesPersona =
      !persona || splitMultiValue(application.persona).includes(persona);
    const matchesHosting = !hosting || application.hosting === hosting;
    const matchesDirectorate =
      !directorate ||
      splitMultiValue(application.directorate).includes(directorate);

    return (
      matchesName &&
      matchesPersona &&
      matchesHosting &&
      matchesDirectorate
    );
  });

  resultsGrid.innerHTML = "";
  filtered.forEach((application) =>
    resultsGrid.appendChild(createCard(application))
  );

  resultsCount.textContent = `${filtered.length} ${
    filtered.length === 1 ? "application" : "applications"
  }`;

  resultsGrid.style.display = filtered.length ? "grid" : "none";
  emptyState.style.display = filtered.length ? "none" : "block";
}

function populateFilter(selectElement, values, allLabel) {
  const currentValue = selectElement.value;
  const uniqueValues = [...new Set(values.filter(Boolean))]
    .map((value) => String(value).trim())
    .filter(Boolean)
    .sort((first, second) =>
      first.localeCompare(second, undefined, { sensitivity: "base" })
    );

  selectElement.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`;

  uniqueValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });

  selectElement.value = currentValue;
}

document
  .getElementById("searchButton")
  .addEventListener("click", renderApplications);

document.getElementById("clearButton").addEventListener("click", () => {
  searchInput.value = "";
  personaFilter.value = "";
  hostingFilter.value = "";
  directorateFilter.value = "";
  renderApplications();
  searchInput.focus();
});

searchInput.addEventListener("input", renderApplications);
[personaFilter, hostingFilter, directorateFilter].forEach((filter) => {
  filter.addEventListener("change", renderApplications);
});

async function initialiseApp() {
  try {
    applications = await loadApplications();

    populateFilter(
      personaFilter,
      applications.flatMap((application) =>
        splitMultiValue(application.persona)
      ),
      "All personas"
    );

    populateFilter(
      hostingFilter,
      applications.map((application) => application.hosting),
      "All hosting"
    );

    populateFilter(
      directorateFilter,
      applications.flatMap((application) =>
        splitMultiValue(application.directorate)
      ),
      "All directorates"
    );

    renderApplications();
  } catch (error) {
    console.error(error);
    resultsGrid.style.display = "none";
    emptyState.style.display = "block";
    emptyState.querySelector("h3").textContent =
      "Application data could not be loaded";
    emptyState.querySelector("p").textContent =
      "Launch this folder through a static web server and check that data.json is present and contains a valid JSON array.";
    resultsCount.textContent = "0 applications";
  }
}

initialiseApp();
