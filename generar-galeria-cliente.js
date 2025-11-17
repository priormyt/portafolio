#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function slugify(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                     // no letras/números → guion
    .replace(/^-+|-+$/g, '');                        // sin guiones al inicio/fin
}

function buildImagesBlock(name, files) {
  const lines = files.map((file, idx) => {
    const src = `img/${file}`;
    const alt = `Retrato profesional de ${name} \u2013 foto ${idx + 1} de la sesi\u00f3n`;
    return `      {src: "${src}", alt: "${alt}"}`;
  });

  const inner = lines
    .map((l, i) => (i < lines.length - 1 ? `${l},` : l))
    .join('\n');

  return [
    '    // Imágenes específicas de la sesión',
    '    const images = [',
    inner,
    '    ];'
  ].join('\n');
}

function updateClientesMap(codeKey, filename) {
  const clientesPath = path.join(__dirname, 'clientes.html');
  if (!fs.existsSync(clientesPath)) {
    console.warn('No se encontró clientes.html, omitiendo actualización del mapa de códigos.');
    return;
  }
  let content = fs.readFileSync(clientesPath, 'utf8');

  if (content.includes(`"${codeKey}"`)) {
    console.log(`El código ${codeKey} ya existe en clientes.html; no se modificó el mapa de galerías.`);
    return;
  }

  const re = /const galleries = {([\s\S]*?)};/;
  const match = content.match(re);
  if (!match) {
    console.warn('No se encontró el objeto "galleries" en clientes.html; añade el código manualmente.');
    return;
  }

  const body = match[1];
  const pairs = [];
  const pairRe = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = pairRe.exec(body)) !== null) {
    pairs.push([m[1], m[2]]);
  }

  pairs.push([codeKey, filename]);

  const lines = pairs.map(([k, v]) => `      "${k}": "${v}"`);
  const newBody =
    '\n' +
    lines
      .map((l, i) => (i < lines.length - 1 ? `${l},` : l))
      .join('\n') +
    '\n      // Agrega más: "CODIGO": "archivo.html"\n    ';

  content = content.replace(re, `const galleries = {${newBody}};`);
  fs.writeFileSync(clientesPath, content, 'utf8');
  console.log(`Se añadió el código ${codeKey} en clientes.html.`);
}

function main() {
  const [,, nameArg, codeArg, imagesArg] = process.argv;

  if (!nameArg || !codeArg || !imagesArg) {
    console.log('Uso: node generar-galeria-cliente.js "Nombre Cliente" CODIGO archivo1.jpg,archivo2.jpg');
    console.log('Ejemplo: node generar-galeria-cliente.js "Valeria" VALERIA2024 Valeria1.jpg,Valeria2.jpg');
    process.exit(1);
  }

  const clientName = nameArg.trim();
  const codeKey = codeArg.trim().toUpperCase();

  const imageFiles = imagesArg
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (!imageFiles.length) {
    console.error('Debes indicar al menos un archivo de imagen.');
    process.exit(1);
  }

  const templatePath = path.join(__dirname, 'cliente-valeria.html');
  if (!fs.existsSync(templatePath)) {
    console.error('No se encontró la plantilla cliente-valeria.html en el directorio del proyecto.');
    process.exit(1);
  }

  let html = fs.readFileSync(templatePath, 'utf8');

  // Reemplaza el nombre "Valeria" por el nombre del nuevo cliente (título, textos, etc.)
  html = html.replace(/Valeria/g, clientName);

  // Reemplaza el bloque de imágenes por uno generado con los archivos indicados
  const imagesRegex = /const images = \[[\s\S]*?\];/;
  if (!imagesRegex.test(html)) {
    console.error('No se encontró el bloque "const images = [...]" en la plantilla.');
    process.exit(1);
  }
  const imagesBlock = buildImagesBlock(clientName, imageFiles);
  html = html.replace(imagesRegex, imagesBlock);

  // Genera nombre de archivo basado en el nombre del cliente
  const slug = slugify(clientName);
  const filename = `cliente-${slug}.html`;
  const outputPath = path.join(__dirname, filename);

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`Galería creada: ${filename}`);

  // Actualiza clientes.html con el nuevo código → archivo
  updateClientesMap(codeKey, filename);
}

main();

