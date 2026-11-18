'use strict'
//
// development_specs_cards_generator.js
//
// Antora extension that generates development spec bands from a local YAML file.
//
// Reads development-specs.yml and injects bands on the home page wherever
// the marker comment appears:
//
//   // DEVELOPMENT-CARDS
//
// Each entry in development-specs.yml should have:
//   - title: Display name
//   - status: draft, frozen, review, etc.
//   - html-url: URL to HTML docs
//   - pdf-url: URL to PDF (optional)
//   - details-url: URL to project page
//   - group: ISA or Non-ISA
//   - fast-tracked: true/false (optional)
//

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

module.exports.register = function () {
  this.on('contentClassified', ({ contentCatalog, playbook }) => {
    // ----------------------------------------------------------------
    // 1. Read development-specs.yml from the playbook directory
    // ----------------------------------------------------------------
    const playbookDir = path.dirname(playbook.file)
    const devSpecsPath = path.join(playbookDir, 'development-specs.yml')

    let devSpecs = []
    if (!fs.existsSync(devSpecsPath)) {
      console.log('[development-specs-bands] development-specs.yml not found — skipping.')
      return
    }

    try {
      const fileContent = fs.readFileSync(devSpecsPath, 'utf8')
      const data = yaml.load(fileContent)
      devSpecs = (data && data['development-specs']) || []
      if (!Array.isArray(devSpecs)) {
        console.warn('[development-specs-bands] development-specs.yml "development-specs" is not an array — skipping.')
        return
      }
    } catch (err) {
      console.error(`[development-specs-bands] Error reading development-specs.yml: ${err.message}`)
      return
    }

    devSpecs = devSpecs.filter(spec => spec.title && spec.status && spec.group)

    console.log(`[development-specs-bands] Loaded ${devSpecs.length} development specs`)
    if (devSpecs.length === 0) {
      console.log('[development-specs-bands] No development specs found in development-specs.yml — skipping.')
      return
    }

    // ----------------------------------------------------------------
    // 2. Find the home page (site-home component, ROOT module, index.adoc)
    // ----------------------------------------------------------------
    const homePages = contentCatalog.findBy({
      component: 'home',
      module: 'ROOT',
      family: 'page',
      relative: 'index.adoc'
    })

    if (!homePages.length) {
      console.log('[development-specs-bands] No home index.adoc page found — skipping.')
      return
    }

    // ----------------------------------------------------------------
    // 3. Inject bands into each home page at the marker
    // ----------------------------------------------------------------
    homePages.forEach((page) => {
      let content = page.contents.toString()
      const markerRe = /^\/\/ DEVELOPMENT-CARDS$/gm

      const replaced = content.replace(markerRe, () => {
        return buildSpecsContainer(devSpecs)
      })

      if (replaced !== content) {
        page.contents = Buffer.from(replaced)
        console.log(`[development-specs-bands] Injected ${devSpecs.length} development spec bands into home page.`)
      }
    })
  })
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function buildSpecsContainer(specs) {
  const cards = specs.map(buildDevCard).join('\n')
  return `++++
<div class="dev-specs-grid">
${cards}
</div>
++++`
}

function buildDevCard(spec) {
  const fastTrackPill = spec['fast-tracked']
    ? ' • ⚡ Fast Track'
    : ''
  
  const htmlLink = spec['html-url']
    ? `<a href="${spec['html-url']}" class="dev-card-external-link" target="_blank" rel="noopener noreferrer">
      <svg class="dev-card-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83l1.41 1.41L19 6.41V10h2V3h-7z"/>
      </svg>
      HTML
    </a>`
    : ''
  
  const pdfUrl = spec['pdf-url'] || '#'
  const pdfClass = spec['pdf-url'] ? 'dev-card-external-link' : 'dev-card-external-link disabled'
  const pdfAttrs = spec['pdf-url'] ? 'target="_blank" rel="noopener noreferrer"' : ''
  const pdfLink = `<a href="${pdfUrl}" class="${pdfClass}" ${pdfAttrs}>
    <svg class="dev-card-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-8-6zm-1 16H8v-2h5v2zm3-4H8v-2h8v2zm0-4H8V8h8v2z"/>
    </svg>
    PDF
  </a>`
  
  const externalLinks = htmlLink || spec['pdf-url']
    ? `<div class="dev-card-external-links">
      ${htmlLink}
      ${pdfLink}
    </div>`
    : ''
  
  const moreLink = spec['details-url']
    ? `<a href="${spec['details-url']}" class="dev-card-more" target="_blank" rel="noopener noreferrer">More</a>`
    : ''

  return `<div class="dev-spec-card">
  <div class="dev-card-banner">DRAFT</div>
  <div class="card-header">
    <h3 class="dev-card-title">${escapeHtml(spec.title)}</h3>
  </div>
  <div class="dev-card-content">
    <div class="dev-card-meta">
      ${escapeHtml(spec.group)}${fastTrackPill} • ${escapeHtml(capitalize(spec.status))}
    </div>
  </div>
  <div class="dev-card-footer">
    <div class="dev-card-actions">
      ${externalLinks}
      ${moreLink}
    </div>
  </div>
</div>`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function capitalize(str) {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
