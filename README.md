# bobby-scraper
Little NodeJS service to download firmwares on webhook called by GitHub Actions.

## .env
```shell
GITHUB_TOKEN="<GITHUB WEBHOOK SECRET TOKEN>"
DOWNLOAD_ELF=false
```

Enable `DOWNLOAD_ELF` if you want to download the ELF file as well, which is useful for debugging, but requires a lot more disk space.

---

This is used with https://github.com/bobbycar-graz/update-service to manage and serve OTA updates for the [bobbycar firmware](https://github.com/bobbycar-graz/bobbycar-boardcomputer-firmware/).