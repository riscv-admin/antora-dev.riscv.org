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
  
  const wipButton = '<button class="dev-card-btn dev-card-btn-wip" disabled>Work in Progress</button>'
  
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
      ${wipButton}
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
