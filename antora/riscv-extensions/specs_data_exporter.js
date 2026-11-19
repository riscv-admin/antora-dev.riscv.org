'use strict'
//
// specs_data_exporter.js
//
// Antora extension that exports spec metadata as JSON for client-side filtering/sorting.
// The JSON is written to build/reference/specs-data.json and can be fetched by JavaScript
// to provide dynamic filtering and sorting UI while maintaining the default twistie view.
//
// Output format:
// {
//   "specs": [
//     {
//       "name": "component-name",
//       "title": "Spec Title",
//       "group": "isa|platform-software|...",
//       "description": "Short description",
//       "version": "v1.0",
//       "releaseDate": "January 2026",
//       "pdfUrl": "URL to PDF",
//       "detailsUrl": "URL to details",
//       "htmlPath": "path to HTML"
//     },
//     ...
//   ]
// }

const fs = require('fs')
const path = require('path')

module.exports.register = function (context) {
    context.on('contentClassified', ({ contentCatalog, playbook }) => {
        console.log('[specs-data-exporter] contentClassified event triggered')
        // Build a lookup map for source-level asciidoc attributes
        const sourceAttrsBySource = new Map()
        for (const source of (playbook?.content?.sources || [])) {
            if (source.asciidoc?.attributes) {
                const startPath = source.startPath || source.start_path
                sourceAttrsBySource.set(getSourceKey(source.url, startPath), source.asciidoc.attributes)
            }
        }

        // Collect all specs by group
        const specsByGroup = new Map()
        let allSpecs = []

        contentCatalog.getComponents().forEach((component) => {
            const latestVersion = component.latest || (component.versions && component.versions.length > 0 ? component.versions[0] : null)
            if (!latestVersion) return

            const attrs = (latestVersion.asciidoc && latestVersion.asciidoc.attributes) || {}
            if (attrs['no-cards'] === true || attrs['no-cards'] === 'true') return

            let group = attrs['page-group']
            if (!group) return
            group = group.trim().toLowerCase() === 'platforms' ? 'platforms' : group.trim()

            // Resolve source-level playbook attributes
            let sourceAttrs = {}
            const pages = contentCatalog.findBy({ component: component.name, version: latestVersion.version, family: 'page' })
            if (pages.length) {
                const origin = pages[0].src?.origin
                if (origin?.url) {
                    sourceAttrs = sourceAttrsBySource.get(getSourceKey(origin.url, origin.startPath)) || {}
                }
            }

            const entry = {
                name:        component.name,
                title:       latestVersion.title || component.title || component.name,
                group:       group,
                description: attrs['page-card-description'] || sourceAttrs['pageCardDescription'] || '',
                version:     latestVersion.version || null,
                releaseDate: formatMonthYear(attrs['page-release-date'] || sourceAttrs['pageReleaseDate'] || null),
                pdfUrl:      attrs['page-pdf_url'] || sourceAttrs['pagePdfUrl'] || null,
                detailsUrl:  attrs['more_details_url'] || sourceAttrs['moreDetailsUrl'] || null,
            }

            if (!specsByGroup.has(group)) specsByGroup.set(group, [])

            // Handle ISA split (unprivileged + privileged)
            if (component.name === 'isa') {
                const unprivDescription = attrs['page-unpriv-description'] || sourceAttrs['pageUnprivDescription'] || 'User-level instruction set and standard extensions.'
                const privDescription = attrs['page-priv-description'] || sourceAttrs['pagePrivDescription'] || 'Privileged architecture, execution modes, and system control.'
                const unprivPdfUrl = attrs['page-unpriv-pdf_url'] || sourceAttrs['pageUnprivPdfUrl'] || '_attachments/riscv-unprivileged.pdf'
                const privPdfUrl = attrs['page-priv-pdf_url'] || sourceAttrs['pagePrivPdfUrl'] || '_attachments/riscv-privileged.pdf'
                const unprivReleaseDate = formatMonthYear(attrs['page-unpriv-release-date'] || sourceAttrs['pageUnprivReleaseDate'] || null)
                const privReleaseDate = formatMonthYear(attrs['page-priv-release-date'] || sourceAttrs['pagePrivReleaseDate'] || null)
                const unprivDetailsUrl = attrs['more_details_unpriv_url'] || sourceAttrs['moreDetailsUnprivUrl'] || entry.detailsUrl
                const privDetailsUrl = attrs['more_details_priv_url'] || sourceAttrs['moreDetailsPrivUrl'] || entry.detailsUrl
                const unprivHtmlPath = attrs['page-unpriv-html-path'] || sourceAttrs['pageUnprivHtmlPath'] || buildShortPath(component.name, 'unpriv/unpriv-index.html')
                const privHtmlPath = attrs['page-priv-html-path'] || sourceAttrs['pagePrivHtmlPath'] || buildShortPath(component.name, 'priv/priv-index.html')

                const unprivEntry = {
                    ...entry,
                    title: 'Unprivileged ISA',
                    description: unprivDescription,
                    releaseDate: unprivReleaseDate,
                    pdfUrl: unprivPdfUrl,
                    detailsUrl: unprivDetailsUrl,
                    htmlPath: unprivHtmlPath,
                }
                const privEntry = {
                    ...entry,
                    title: 'Privileged ISA',
                    description: privDescription,
                    releaseDate: privReleaseDate,
                    pdfUrl: privPdfUrl,
                    detailsUrl: privDetailsUrl,
                    htmlPath: privHtmlPath,
                }
                specsByGroup.get(group).push(unprivEntry, privEntry)
                allSpecs.push(unprivEntry, privEntry)
                return
            }

            const htmlPath = buildShortPath(component.name, 'index.html')
            const entryWithPath = { ...entry, htmlPath }
            specsByGroup.get(group).push(entryWithPath)
            allSpecs.push(entryWithPath)
        })

        if (allSpecs.length === 0) {
            console.log('[specs-data-exporter] No specs found — skipping JSON export.')
            return
        }

        console.log(`[specs-data-exporter] Collected ${allSpecs.length} specs`)

        // Write JSON immediately
        try {
            const outputDir = playbook.output?.dir || './build/reference'
            const dataFile = path.join(outputDir, 'specs-data.json')
            
            // Ensure directory exists
            const dirPath = path.dirname(dataFile)
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true })
            }

            const jsonData = {
                generated: new Date().toISOString(),
                specs: allSpecs,
            }

            fs.writeFileSync(dataFile, JSON.stringify(jsonData, null, 2))
            console.log(`[specs-data-exporter] ✓ Exported ${allSpecs.length} specs to ${dataFile}`)
        } catch (err) {
            console.error(`[specs-data-exporter] ✗ Failed to export JSON:`, err.message)
        }
    })
}

// ================================================================
// Helpers (copied from homepage_cards_generator.js for consistency)
// ================================================================

function getSourceKey(url, startPath) {
    const normalized = url.replace(/\.git$/, '')
    const path = (startPath || '').replace(/^\/+/, '').replace(/\/+$/, '')
    return path ? `${normalized}:${path}` : normalized
}

function formatMonthYear(dateStr) {
    if (!dateStr) return null
    const match = dateStr.match(/([A-Za-z]+)\s+(\d{4})/)
    return match ? `${match[1]} ${match[2]}` : dateStr
}

function buildShortPath(componentName, filePath) {
    return `../${componentName}/${filePath}`
}
