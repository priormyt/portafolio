#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

function slugify(str) {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // no letras/números → guion
    .replace(/^-+|-+$/g, ''); // sin guiones al inicio/fin
}

function buildImagesBlock(name, files) {
  const lines = files.map((file, idx) => {
    // La galería vive en /Galerias_privadas, las imágenes en /img
    const src = `../img/${file}`;
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
    '    ];',
  ].join('\n');
}

function updateClientesMap(codeKey, filename) {
  const clientesPath = path.join(__dirname, 'clientes.html');
  if (!fs.existsSync(clientesPath)) {
    console.warn(
      'No se encontró clientes.html, omitiendo actualización del mapa de códigos.'
    );
    return;
  }
  let content = fs.readFileSync(clientesPath, 'utf8');

  if (content.includes(`"${codeKey}"`)) {
    console.log(
      `El código ${codeKey} ya existe en clientes.html; no se modificó el mapa de galerías.`
    );
    return;
  }

  const re = /const galleries = {([\s\S]*?)};/;
  const match = content.match(re);
  if (!match) {
    console.warn(
      'No se encontró el objeto "galleries" en clientes.html; añade el código manualmente.'
    );
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

function generarEmailCliente(clientName, codeKey, galleryFilename) {
  const templateEmailPath = path.join(
    __dirname,
    'Emails_personalizados',
    'email-galeria-cliente.html'
  );
  if (!fs.existsSync(templateEmailPath)) {
    console.warn(
      'No se encontró email-galeria-cliente.html, se omitió la creación del email.'
    );
    return;
  }

  let emailHtml = fs.readFileSync(templateEmailPath, 'utf8');

  const baseUrl = 'https://www.ante.photo';
  const urlGaleria = `${baseUrl}/${galleryFilename}`;

  emailHtml = emailHtml
    .replace(/{{NOMBRE_CLIENTE}}/g, clientName)
    .replace(/{{URL_GALERIA}}/g, urlGaleria)
    .replace(/{{CODIGO_ACCESO}}/g, codeKey);

  const slug = slugify(clientName);
  const emailFilename = `email-${slug}.html`;
  const emailsDir = 'Emails_personalizados';
  const emailOutputPath = path.join(__dirname, emailsDir, emailFilename);

  fs.writeFileSync(emailOutputPath, emailHtml, 'utf8');
  console.log(`Email creado: ${emailFilename}`);
}

function ensureThumb(imageFile) {
  const src = path.join(__dirname, 'img', imageFile);
  const destDir = path.join(__dirname, 'img', 'thumb');
  const dest = path.join(destDir, imageFile);

  if (!fs.existsSync(src)) {
    console.warn(`No se encontró la imagen original: ${src}`);
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });

  try {
    // Redimensiona a un máximo de 1400px para reducir peso (≈ <300 KB usualmente)
    execSync(`sips -Z 1400 "${src}" --out "${dest}"`, { stdio: 'ignore' });
  } catch (err) {
    console.warn(`No se pudo generar miniatura para ${imageFile}: ${err.message}`);
  }
}

function updateGaleria(images, clientName) {
  const filePath = path.join(__dirname, 'galeria.html');
  if (!fs.existsSync(filePath)) {
    console.warn('No se encontró galeria.html, se omitió agregar las fotos a la galería general.');
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const re = /const images = \[([\s\S]*?)\];/;
  const match = content.match(re);
  if (!match) {
    console.warn('No se encontró el array const images en galeria.html');
    return;
  }

  const body = match[1];
  const existing = new Set();
  const srcRe = /\{\s*src:\s*"([^"]+)"/g;
  let m;
  while ((m = srcRe.exec(body)) !== null) {
    existing.add(m[1]);
  }

  const newEntries = [];
  images.forEach((file) => {
    const src = `img/${file}`;
    if (existing.has(src)) return;
    const alt = `Retrato profesional México – foto de ${clientName} para perfil y redes`;
    newEntries.push(`      {src: "${src}", alt: "${alt}"}`);
  });

  if (!newEntries.length) return;

  const bodyTrimmed = body.trim();
  const insert = (bodyTrimmed ? '\n' : '\n') + newEntries.join(',\n') + '\n';
  const newBody = `${body}${insert}`;
  content = content.replace(re, `const images = [${newBody}    ];`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Añadidas las fotos a la galería general.');
}

function deleteClientByName(clientName) {
  const slug = slugify(clientName);
  const galleryDir = 'Galerias_privadas';
  const emailsDir = 'Emails_personalizados';

  const galleryRelPath = `${galleryDir}/cliente-${slug}.html`;
  const galleryPath = path.join(__dirname, galleryRelPath);
  const emailPath = path.join(__dirname, emailsDir, `email-${slug}.html`);

  // Eliminar galería si existe
  if (fs.existsSync(galleryPath)) {
    fs.unlinkSync(galleryPath);
    console.log(`Galería eliminada: ${galleryRelPath}`);
  } else {
    console.log(`No se encontró la galería: ${galleryRelPath}`);
  }

  // Eliminar email si existe
  if (fs.existsSync(emailPath)) {
    fs.unlinkSync(emailPath);
    console.log(`Email eliminado: ${emailsDir}/email-${slug}.html`);
  } else {
    console.log(`No se encontró el email: ${emailsDir}/email-${slug}.html`);
  }

  // Eliminar entrada en clientes.html
  const clientesPath = path.join(__dirname, 'clientes.html');
  if (!fs.existsSync(clientesPath)) {
    console.warn('No se encontró clientes.html; no se pudo actualizar el mapa de códigos.');
    return;
  }
  let content = fs.readFileSync(clientesPath, 'utf8');
  const re = /const galleries = {([\s\S]*?)};/;
  const match = content.match(re);
  if (!match) {
    console.warn('No se encontró el objeto "galleries" en clientes.html; revisa el archivo manualmente.');
    return;
  }

  const body = match[1];
  const pairs = [];
  const pairRe = /"([^"]+)"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = pairRe.exec(body)) !== null) {
    pairs.push([m[1], m[2]]);
  }

  const filtered = pairs.filter(([, file]) => file !== galleryRelPath);
  if (filtered.length === pairs.length) {
    console.log('No se encontró ninguna entrada en galleries para ese cliente.');
    return;
  }

  const lines = filtered.map(([k, v]) => `      "${k}": "${v}"`);
  const newBody =
    '\n' +
    lines
      .map((l, i) => (i < lines.length - 1 ? `${l},` : l))
      .join('\n') +
    '\n      // Agrega más: "CODIGO": "archivo.html"\n    ';

  content = content.replace(re, `const galleries = {${newBody}};`);
  fs.writeFileSync(clientesPath, content, 'utf8');
  console.log('Entrada eliminada de galleries en clientes.html.');
}

function askDeleteClient() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    '\n¿Quieres eliminar algún cliente? (s/n): ',
    (answer) => {
      const ans = (answer || '').trim().toLowerCase();
      if (!ans || ans === 'n' || ans === 'no') {
        rl.close();
        return;
      }

      rl.question(
        'Nombre del cliente a eliminar (tal como lo escribiste al crearlo): ',
        (nameAns) => {
          const name = (nameAns || '').trim();
          if (!name) {
            console.error('Nombre vacío. No se realizó ninguna eliminación.');
            rl.close();
            return;
          }
          deleteClientByName(name);
          rl.close();
        }
      );
    }
  );
}

function runGenerator(clientName, codeKey, imageFiles) {
  const templatePath = path.join(
    __dirname,
    'Galerias_privadas',
    'cliente-valeria.html'
  );
  if (!fs.existsSync(templatePath)) {
    console.error(
      'No se encontró la plantilla cliente-valeria.html en el directorio del proyecto.'
    );
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
  const galleryDir = 'Galerias_privadas';
  const outputPath = path.join(__dirname, galleryDir, filename);

  // Asegura que existan los directorios destino
  fs.mkdirSync(path.join(__dirname, galleryDir), { recursive: true });
  fs.mkdirSync(path.join(__dirname, 'Emails_personalizados'), { recursive: true });

  // Genera miniaturas optimizadas para la galería general
  imageFiles.forEach((file) => ensureThumb(file));

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`Galería creada: ${filename}`);

  // Actualiza clientes.html con el nuevo código → archivo
  const relativeGalleryPath = `${galleryDir}/${filename}`;
  updateClientesMap(codeKey, relativeGalleryPath);

  // Genera plantilla de email personalizada
  generarEmailCliente(clientName, codeKey, relativeGalleryPath);

  // Añade las fotos a la galería general
  updateGaleria(imageFiles, clientName);
}

function askInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('=== Crear nueva galería de cliente (modo interactivo) ===\n');

  rl.question('Nombre del cliente (ej. Valeria): ', (nameAns) => {
    const clientName = (nameAns || '').trim();
    if (!clientName) {
      console.error('El nombre del cliente no puede estar vacío.');
      rl.close();
      process.exit(1);
    }

    rl.question('Código de acceso (ej. VALERIA2024): ', (codeAns) => {
      const codeKey = (codeAns || '').trim().toUpperCase();
      if (!codeKey) {
        console.error('El código de acceso no puede estar vacío.');
        rl.close();
        process.exit(1);
      }

      rl.question(
        'Archivos de imagen (separados por coma, ej. Valeria1.jpg,Valeria2.jpg): ',
        (filesAns) => {
          const imageFiles = (filesAns || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => (name.includes('.') ? name : `${name}.jpg`));

          if (!imageFiles.length) {
            console.error('Debes indicar al menos un archivo de imagen.');
            rl.close();
            process.exit(1);
          }

          rl.close();
          runGenerator(clientName, codeKey, imageFiles);
          askDeleteClient();
        }
      );
    });
  });
}

function main() {
  const [, , nameArg, codeArg, imagesArg] = process.argv;

  // Si se pasan argumentos por CLI, úsalo en modo directo
  if (nameArg && codeArg && imagesArg) {
    const clientName = nameArg.trim();
    const codeKey = codeArg.trim().toUpperCase();
    const imageFiles = imagesArg
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => (name.includes('.') ? name : `${name}.jpg`));

    if (!imageFiles.length) {
      console.error('Debes indicar al menos un archivo de imagen.');
      process.exit(1);
    }

    runGenerator(clientName, codeKey, imageFiles);
    askDeleteClient();
    return;
  }

  // Si no hay argumentos, modo interactivo paso a paso
  askInteractive();
}

main();
