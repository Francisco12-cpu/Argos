/**
 * Efeitos de tela feitos com CSS: ruído, glitch e o "liga" do visor.
 * O canvas fica só com o que depende da posição dos objetos.
 */

/** Gera uma textura de ruído e a entrega ao CSS como --noise. */
export function installNoise(root = document.documentElement, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = Math.random() * 90;
  }
  ctx.putImageData(image, 0, 0);
  root.style.setProperty('--noise', `url(${canvas.toDataURL('image/png')})`);
}

/** Reinicia uma animação CSS ligada a uma classe e a remove ao terminar. */
export function pulseClass(element, className, durationMs) {
  element.classList.remove(className);
  void element.offsetWidth; // força o navegador a reiniciar a animação
  element.classList.add(className);
  clearTimeout(element[`__${className}`]);
  element[`__${className}`] = setTimeout(() => element.classList.remove(className), durationMs);
}

export const glitch = (element, durationMs = 220) => pulseClass(element, 'is-glitching', durationMs);

export const powerOn = (element, durationMs = 700) => pulseClass(element, 'is-powering-on', durationMs);
