import path from "path";
import { promises as fs } from "fs";
import { exec } from "child_process";
import chalk from "chalk";
import ora from "ora";
import { getWikiRoot, readConfig } from "../utils/config.js";
import { fileExists } from "../utils/fs.js";
import { appendLog } from "../wiki/log.js";
import type { WikiGraph } from "../types.js";

interface ExportOptions {
  graph: boolean;
  output?: string;
  view?: boolean;
}

/**
 * Handles the `wikimind export --graph [--output <path>]` command.
 *
 * Reads wiki/graph.json and generates a standalone interactive HTML
 * file visualizing the knowledge graph as a neural pathway map.
 */
export async function exportCommand(options: ExportOptions): Promise<void> {
  if (!options.graph) {
    console.error(
      chalk.yellow("Specify an export type. Usage: wikimind export --graph")
    );
    process.exit(1);
  }

  const root = await getWikiRoot();
  if (!root) {
    console.error(chalk.red("Not a wikimind project. Run: wikimind init"));
    process.exit(1);
  }

  const config = await readConfig(root);
  const graphPath = path.join(root, "wiki", "graph.json");

  if (!(await fileExists(graphPath))) {
    console.error(
      chalk.yellow(
        "No graph data found. Run wikimind compile first."
      )
    );
    process.exit(1);
  }

  const graphRaw = await fs.readFile(graphPath, "utf-8");
  const graph = JSON.parse(graphRaw) as WikiGraph;

  if (!graph.nodes || graph.nodes.length === 0) {
    console.error(
      chalk.yellow(
        "No graph data found. Run wikimind compile first."
      )
    );
    process.exit(1);
  }

  const spinner = ora("Generating graph visualization...").start();

  const outputPath = options.output
    ? path.resolve(options.output)
    : path.join(root, "wiki", "graph.html");

  const html = generateGraphHtml(config.name, graph);
  await fs.writeFile(outputPath, html, "utf-8");

  const relPath = path.relative(root, outputPath);

  if (options.view) {
    spinner.succeed(
      chalk.green(`Graph exported to ${relPath} — opening in browser...`)
    );
    const platform = process.platform;
    const openCmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${openCmd} "${outputPath}"`);
  } else {
    spinner.succeed(
      chalk.green(`Graph exported to ${relPath} — open in any browser.`)
    );
  }

  await appendLog(
    root,
    "export",
    `Graph exported (${graph.nodes.length} nodes, ${graph.edges.length} edges)`
  );
}

function generateGraphHtml(wikiName: string, graph: WikiGraph): string {
  const graphJson = JSON.stringify(graph);
  const escapedName = wikiName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapedName} — Knowledge Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #FAFAFA;
      color: #000;
      overflow: hidden;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0D0D0D; color: #fff; }
    }
    #header {
      position: fixed; top: 0; left: 0; right: 0;
      padding: 16px 24px;
      z-index: 10;
    }
    #header h1 { font-size: 14px; font-weight: 500; opacity: 0.6; }
    #legend {
      position: fixed; top: 16px; right: 24px;
      display: flex; flex-direction: column; gap: 6px;
      font-size: 11px; opacity: 0.5; z-index: 10;
    }
    #legend span { display: flex; align-items: center; gap: 6px; }
    #legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    #stats {
      position: fixed; bottom: 16px; left: 24px;
      font-size: 11px; opacity: 0.3;
    }
    canvas { display: block; width: 100vw; height: 100vh; cursor: crosshair; }
    #tooltip {
      position: fixed; display: none; padding: 8px 14px; border-radius: 8px;
      font-size: 12px; pointer-events: none; z-index: 20;
    }
    @media (prefers-color-scheme: dark) {
      #tooltip { background: rgba(20,20,20,0.92); border: 0.5px solid rgba(255,255,255,0.1); color: #fff; }
    }
    @media (prefers-color-scheme: light) {
      #tooltip { background: rgba(255,255,255,0.95); border: 0.5px solid rgba(0,0,0,0.08); color: #000; }
    }
    .powered { position: fixed; bottom: 16px; right: 24px; font-size: 10px; opacity: 0.25; }
    .powered a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div id="header">
    <h1>${escapedName} — knowledge graph</h1>
  </div>
  <div id="legend"></div>
  <canvas id="graph"></canvas>
  <div id="tooltip"></div>
  <div id="stats">${graph.nodes.length} concepts · ${graph.edges.length} connections</div>
  <div class="powered">built with <a href="https://github.com/akashikprotocol/wikimind">wikimind</a></div>
  <script>
    const GRAPH_DATA = ${graphJson};
    (function() {
      'use strict';

      const clusters = GRAPH_DATA.clusters || [{ id: 'uncategorised', name: 'Uncategorised', color: '#888780' }];
      const nodes = GRAPH_DATA.nodes || [];
      const edges = GRAPH_DATA.edges || [];

      // Build cluster color map
      const clusterMap = {};
      clusters.forEach(function(c) { clusterMap[c.id] = c; });

      // Build adjacency
      const adj = {};
      nodes.forEach(function(n) { adj[n.id] = []; });
      edges.forEach(function(e) {
        if (adj[e.from]) adj[e.from].push(e);
        if (adj[e.to]) adj[e.to].push(e);
      });

      // Detect dark mode
      function isDark() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      // Legend
      var legendEl = document.getElementById('legend');
      clusters.forEach(function(c) {
        var s = document.createElement('span');
        s.innerHTML = '<i style="background:' + c.color + '"></i>' + c.name;
        legendEl.appendChild(s);
      });

      // Canvas setup
      var canvas = document.getElementById('graph');
      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var W, H;

      function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        layoutNodes();
        draw();
      }

      // Node positions (absolute pixels)
      var nodePos = {};

      // Deterministic pseudo-random
      function seededRandom(seed) {
        var x = Math.sin(seed + 1) * 43758.5453;
        return x - Math.floor(x);
      }

      function layoutNodes() {
        // Group nodes by cluster
        var clusterNodes = {};
        clusters.forEach(function(c) { clusterNodes[c.id] = []; });
        nodes.forEach(function(n) {
          var cid = n.cluster || 'uncategorised';
          if (!clusterNodes[cid]) clusterNodes[cid] = [];
          clusterNodes[cid].push(n);
        });

        // Position cluster centers in a circle
        var cx = W / 2;
        var cy = H / 2;
        var radius = Math.min(W, H) * 0.3;
        var clusterIds = Object.keys(clusterNodes).filter(function(k) { return clusterNodes[k].length > 0; });
        var clusterCenters = {};

        clusterIds.forEach(function(cid, i) {
          var angle = (2 * Math.PI * i) / clusterIds.length - Math.PI / 2;
          clusterCenters[cid] = {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle)
          };
        });

        // For single cluster, center it
        if (clusterIds.length === 1) {
          clusterCenters[clusterIds[0]] = { x: cx, y: cy };
        }

        // Position nodes in spiral around cluster center
        clusterIds.forEach(function(cid) {
          var cnodes = clusterNodes[cid];
          var center = clusterCenters[cid];
          var maxSpread = Math.min(W, H) * 0.18;
          var spread = Math.min(30 + cnodes.length * 5, maxSpread);

          cnodes.forEach(function(n, i) {
            var angle = i * 2.4; // golden angle approximation
            var r = spread * Math.sqrt(i + 1) / Math.sqrt(cnodes.length + 1);
            var jitterX = (seededRandom(i * 7 + 3) - 0.5) * 14;
            var jitterY = (seededRandom(i * 13 + 7) - 0.5) * 14;
            nodePos[n.id] = {
              x: center.x + r * Math.cos(angle) + jitterX,
              y: center.y + r * Math.sin(angle) + jitterY
            };
          });
        });

        // Clamp all nodes to viewport with padding
        var pad = 60;
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach(function(n) {
          var p = nodePos[n.id];
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        });
        var rangeX = maxX - minX || 1;
        var rangeY = maxY - minY || 1;
        var availW = W - pad * 2;
        var availH = H - pad * 2;
        var scale = Math.min(availW / rangeX, availH / rangeY, 1);
        var offsetX = (W - rangeX * scale) / 2 - minX * scale;
        var offsetY = (H - rangeY * scale) / 2 - minY * scale;
        nodes.forEach(function(n) {
          var p = nodePos[n.id];
          p.x = p.x * scale + offsetX;
          p.y = p.y * scale + offsetY;
        });
      }

      // Tooltip
      var tooltipEl = document.getElementById('tooltip');
      var hoveredNode = null;
      var hoveredConnected = new Set();

      // Pulse animation state
      var pulseParticles = [];
      var pulseStart = 0;
      var animFrame = null;

      function getNodeAt(mx, my) {
        // Check nodes in reverse (drawn last = on top)
        for (var i = nodes.length - 1; i >= 0; i--) {
          var n = nodes[i];
          var p = nodePos[n.id];
          if (!p) continue;
          var r = 3 + n.links * 0.8;
          var dx = mx - p.x;
          var dy = my - p.y;
          if (dx * dx + dy * dy <= (r + 4) * (r + 4)) return n;
        }
        return null;
      }

      function getClusterColor(n) {
        var c = clusterMap[n.cluster || 'uncategorised'];
        return c ? c.color : '#888780';
      }

      function getClusterName(n) {
        var c = clusterMap[n.cluster || 'uncategorised'];
        return c ? c.name : 'Uncategorised';
      }

      function hexToRgb(hex) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return { r: r, g: g, b: b };
      }

      // Bezier control point
      function controlPoint(x1, y1, x2, y2) {
        var mx = (x1 + x2) / 2;
        var my = (y1 + y2) / 2;
        var dx = x2 - x1;
        var dy = y2 - y1;
        var dist = Math.sqrt(dx * dx + dy * dy);
        var offset = dist * 0.15;
        // Perpendicular
        var nx = -dy / (dist || 1);
        var ny = dx / (dist || 1);
        return { x: mx + nx * offset, y: my + ny * offset };
      }

      function draw() {
        ctx.clearRect(0, 0, W, H);
        var dark = isDark();
        var baseTextColor = dark ? '255,255,255' : '0,0,0';
        var baseEdgeColor = dark ? '255,255,255' : '0,0,0';

        var hovered = hoveredNode;
        var now = Date.now();

        // ── Edges ────────────────────────────────────────────────────
        edges.forEach(function(e) {
          var pFrom = nodePos[e.from];
          var pTo = nodePos[e.to];
          if (!pFrom || !pTo) return;

          var fromNode = nodes.find(function(n) { return n.id === e.from; });
          var toNode = nodes.find(function(n) { return n.id === e.to; });
          if (!fromNode || !toNode) return;

          var sameCluster = fromNode.cluster === toNode.cluster;
          var isConnected = hovered && (hoveredConnected.has(e.from) || hoveredConnected.has(e.to)) &&
                            (e.from === hovered.id || e.to === hovered.id);

          var cp = controlPoint(pFrom.x, pFrom.y, pTo.x, pTo.y);

          ctx.beginPath();
          ctx.moveTo(pFrom.x, pFrom.y);
          ctx.quadraticCurveTo(cp.x, cp.y, pTo.x, pTo.y);

          if (hovered) {
            if (isConnected) {
              var color = getClusterColor(hovered);
              var rgb = hexToRgb(color);
              ctx.strokeStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.6)';
              ctx.lineWidth = 2;
              ctx.setLineDash([]);
            } else {
              ctx.strokeStyle = 'rgba(' + baseEdgeColor + ',0.03)';
              ctx.lineWidth = 0.5;
              ctx.setLineDash(sameCluster ? [] : [4, 4]);
            }
          } else {
            if (sameCluster) {
              var color = getClusterColor(fromNode);
              var rgb = hexToRgb(color);
              ctx.strokeStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.12)';
              ctx.lineWidth = 0.5;
              ctx.setLineDash([]);
            } else {
              ctx.strokeStyle = 'rgba(' + baseEdgeColor + ',0.06)';
              ctx.lineWidth = 0.5;
              ctx.setLineDash([4, 4]);
            }
          }

          ctx.stroke();
          ctx.setLineDash([]);
        });

        // ── Pulse particles ──────────────────────────────────────────
        if (hovered && pulseParticles.length > 0) {
          var elapsed = now - pulseStart;
          if (elapsed < 1200) {
            pulseParticles.forEach(function(pp, idx) {
              var delay = idx * 80;
              var t = (elapsed - delay) / 400;
              if (t < 0 || t > 1) return;

              var pFrom = nodePos[pp.from];
              var pTo = nodePos[pp.to];
              if (!pFrom || !pTo) return;

              var cp = controlPoint(pFrom.x, pFrom.y, pTo.x, pTo.y);
              // Quadratic bezier at t
              var u = 1 - t;
              var px = u * u * pFrom.x + 2 * u * t * cp.x + t * t * pTo.x;
              var py = u * u * pFrom.y + 2 * u * t * cp.y + t * t * pTo.y;

              var color = getClusterColor(hovered);
              var rgb = hexToRgb(color);
              var alpha = (1 - t) * 0.8;

              ctx.beginPath();
              ctx.arc(px, py, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
              ctx.fill();
            });
          }
        }

        // ── Cluster labels ───────────────────────────────────────────
        var clusterPositions = {};
        nodes.forEach(function(n) {
          var cid = n.cluster || 'uncategorised';
          var p = nodePos[n.id];
          if (!p) return;
          if (!clusterPositions[cid]) clusterPositions[cid] = { sumX: 0, minY: Infinity, count: 0 };
          clusterPositions[cid].sumX += p.x;
          if (p.y < clusterPositions[cid].minY) clusterPositions[cid].minY = p.y;
          clusterPositions[cid].count++;
        });

        clusters.forEach(function(c) {
          var cp = clusterPositions[c.id];
          if (!cp || cp.count === 0) return;

          var labelX = cp.sumX / cp.count;
          var labelY = cp.minY - 22;

          var labelOpacity = 0.35;
          if (hovered) {
            var hoveredCluster = hovered.cluster || 'uncategorised';
            labelOpacity = (c.id === hoveredCluster) ? 0.5 : 0.05;
          }

          ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
          ctx.letterSpacing = '2px';
          ctx.fillStyle = 'rgba(' + baseTextColor + ',' + labelOpacity + ')';
          ctx.textAlign = 'center';
          ctx.fillText(c.name.toUpperCase(), labelX, labelY);
          ctx.letterSpacing = '0px';
        });

        // ── Nodes ────────────────────────────────────────────────────
        nodes.forEach(function(n) {
          var p = nodePos[n.id];
          if (!p) return;
          var r = 3 + n.links * 0.8;
          var color = getClusterColor(n);
          var rgb = hexToRgb(color);
          var isHovered = hovered && hovered.id === n.id;
          var isConnected = hovered && hoveredConnected.has(n.id);
          var dimmed = hovered && !isHovered && !isConnected;

          var nodeOpacity = dimmed ? 0.1 : 1.0;

          // Halo for high-link nodes
          if (n.links >= 5 && !dimmed) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.25)';
            ctx.fill();
          }

          // Hover highlight ring
          if (isHovered) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.15)';
            ctx.fill();
          }

          // Node circle
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + nodeOpacity + ')';
          ctx.fill();

          // Labels for high-link nodes
          if (n.links >= 5 && !dimmed) {
            ctx.font = '9px -apple-system, BlinkMacSystemFont, sans-serif';
            ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0.6)';
            ctx.textAlign = 'center';
            ctx.fillText(n.title, p.x, p.y + r + 14);
          }
        });

        // ── Continue animation ───────────────────────────────────────
        if (hovered && pulseParticles.length > 0 && (now - pulseStart) < 1200) {
          animFrame = requestAnimationFrame(draw);
        }
      }

      function startPulse(node) {
        pulseParticles = [];
        var connected = adj[node.id] || [];
        connected.forEach(function(e) {
          var target = e.from === node.id ? e.to : e.from;
          pulseParticles.push({ from: node.id, to: target });
        });
        pulseStart = Date.now();
        if (animFrame) cancelAnimationFrame(animFrame);
        animFrame = requestAnimationFrame(draw);
      }

      canvas.addEventListener('mousemove', function(e) {
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;

        var node = getNodeAt(mx, my);

        if (node !== hoveredNode) {
          hoveredNode = node;
          hoveredConnected = new Set();

          if (node) {
            canvas.style.cursor = 'pointer';
            var connected = adj[node.id] || [];
            connected.forEach(function(edge) {
              hoveredConnected.add(edge.from);
              hoveredConnected.add(edge.to);
            });

            // Show tooltip
            var connections = connected.length;
            var clusterName = getClusterName(node);
            tooltipEl.innerHTML =
              '<div style="font-size:13px;font-weight:600;margin-bottom:2px">' + node.title + '</div>' +
              '<div style="font-size:11px;opacity:0.5">' + node.links + ' links · ' + connections + ' connections · ' + clusterName + '</div>';
            tooltipEl.style.display = 'block';

            var tp = nodePos[node.id];
            var tx = tp.x;
            var ty = tp.y - 45;
            if (ty < 50) ty = tp.y + 30;
            tooltipEl.style.left = Math.min(tx - 60, W - 200) + 'px';
            tooltipEl.style.top = ty + 'px';

            startPulse(node);
          } else {
            canvas.style.cursor = 'crosshair';
            tooltipEl.style.display = 'none';
            pulseParticles = [];
          }

          draw();
        } else if (node) {
          // Update tooltip position
          var tp = nodePos[node.id];
          var tx = tp.x;
          var ty = tp.y - 45;
          if (ty < 50) ty = tp.y + 30;
          tooltipEl.style.left = Math.min(tx - 60, W - 200) + 'px';
          tooltipEl.style.top = ty + 'px';
        }
      });

      canvas.addEventListener('click', function(e) {
        var rect = canvas.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var node = getNodeAt(mx, my);
        if (node) {
          window.open('concepts/' + node.id + '.md', '_blank');
        }
      });

      canvas.addEventListener('mouseleave', function() {
        hoveredNode = null;
        hoveredConnected = new Set();
        tooltipEl.style.display = 'none';
        pulseParticles = [];
        canvas.style.cursor = 'crosshair';
        draw();
      });

      window.addEventListener('resize', resize);
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() { draw(); });

      resize();
    })();
  </script>
</body>
</html>`;
}
