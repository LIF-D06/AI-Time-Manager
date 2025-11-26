import time
import sys

from src.browser_emulator import BrowserEmulator

# 接受命令行参数
if len(sys.argv) > 2:
    username = sys.argv[1]
    password = sys.argv[2]
else:
    # 如果没有提供命令行参数，使用默认值
    print("Error: Missing username or password arguments")
    sys.exit(1)


browser = BrowserEmulator(headless=False)
browser.start()
browser.visit("https://ebridge.xjtlu.edu.cn")
time.sleep(3)
browser.focusedpage.query_selector("#MUA_CODE\\.DUMMY\\.MENSYS").fill(username)
browser.focusedpage.query_selector("#PASSWORD\\.DUMMY\\.MENSYS").fill(password)
browser.focusedpage.query_selector("body > div > form > div:nth-child(9) > div > div > div.sv-panel-body > div > fieldset > div:nth-child(4) > div.sv-col-sm-6.sv-col-sm-push-6 > div > input").click()
browser.wait_for_load()
browser.eval_js('document.querySelector("body > div.sv-page-wrapper > div.sv-page-content.sv-container-fluid > div.sv-row > div:nth-child(2) > div > div > div:nth-child(2) > div.sv-list-group.sv-portal-2-col > div > div.sv-tiled-container > div > div > div:nth-child(1) > a").target = ""')
browser.focusedpage.query_selector("body > div.sv-page-wrapper > div.sv-page-content.sv-container-fluid > div.sv-row > div:nth-child(2) > div > div > div:nth-child(2) > div.sv-list-group.sv-portal-2-col > div > div.sv-tiled-container > div > div > div:nth-child(1) > a").click()
browser.wait_for_load()
browser.focusedpage.get_by_role("button", name=" Timetables ").click()
browser.eval_js('window.location = document.querySelector("#collapsible-panel-I7").childNodes[3].childNodes[1].childNodes[1].childNodes[0].childNodes[0].childNodes[3].childNodes[5].childNodes[3].childNodes[0].href')
# browser.focusedpage.get_by_role("row", name="My Class Timetable Timetables").get_by_role("link").click()

time.sleep(1)
browser.focusedpage.get_by_role("button", name="确定").click()
browser.focusedpage.query_selector("body > div.sv-page-wrapper > div.sv-page-content.sv-container-fluid > div.sv-row > div > div:nth-child(2) > div.sv-list-group > div > div > div.sv-row > div > div:nth-child(1) > div > a > div").click()
print(browser.eval_js("document.getElementById('myFrame').src"))
time.sleep(2)