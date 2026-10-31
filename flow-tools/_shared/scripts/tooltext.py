import re,sys
t=open(sys.argv[1]).read()
i=t.find('Iframe'); j=t.find('heading "Trình tạo công cụ"', i)
seg=t[i:j if j>0 else len(t)]
print(' | '.join(re.findall(r'(?:StaticText|button|textbox[^"]*|cell) "([^"]+)"', seg)))
