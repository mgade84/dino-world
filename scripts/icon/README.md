# App icon

`make_svg.py` draws the icon (a roaring T-Rex head against a storm, lit by lightning) as SVG:
`icon.svg` full bleed, and `icon-maskable.svg` with the artwork scaled into Android's safe zone.

```bash
python3 scripts/icon/make_svg.py /tmp/icon
# Render each at its size with any headless browser, e.g. Chrome:
google-chrome --headless=new --hide-scrollbars --window-size=512,512 --screenshot=public/icon-512.png file:///tmp/icon/icon.html
google-chrome --headless=new --hide-scrollbars --window-size=192,192 --screenshot=public/icon-192.png file:///tmp/icon/icon.html
google-chrome --headless=new --hide-scrollbars --window-size=180,180 --screenshot=public/apple-touch-icon.png file:///tmp/icon/icon.html
google-chrome --headless=new --hide-scrollbars --window-size=512,512 --screenshot=public/icon-maskable-512.png file:///tmp/icon/icon-maskable.html
```
