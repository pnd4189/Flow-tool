/**
 * Dịch vụ này lưu trữ mã nguồn của ứng dụng để người dùng có thể tải về.
 * Lưu ý: Khi cập nhật các file khác, cần cập nhật nội dung tương ứng ở đây.
 */

export const getProjectFiles = (
  appCode: string,
  typesCode: string,
  constantsCode: string,
  sceneParserCode: string,
  consistencyManagerCode: string,
  creditServiceCode: string,
  videoProcessorCode: string
) => {
  return [
    { name: 'App.tsx', content: appCode },
    { name: 'types.ts', content: typesCode },
    { name: 'constants.ts', content: constantsCode },
    { name: 'services/sceneParser.ts', content: sceneParserCode },
    { name: 'services/consistencyManager.ts', content: consistencyManagerCode },
    { name: 'services/creditService.ts', content: creditServiceCode },
    { name: 'services/videoProcessor.ts', content: videoProcessorCode },
    { name: 'package.json', content: JSON.stringify({
      name: "veo-batch-director",
      version: "1.0.0",
      dependencies: {
        "react": "^19.0.0",
        "react-dom": "^19.0.0",
        "flow-sdk": "latest",
        "jszip": "^3.10.1",
        "mediabunny": "latest",
        "@mediabunny/ac3": "latest"
      }
    }, null, 2) },
    { name: 'README.md', content: '# Veo Batch Director Pro\n\nĐây là mã nguồn của ứng dụng sản xuất video hàng loạt. Để chạy project này, bạn cần môi trường React và cài đặt các dependencies tương ứng.' }
  ];
};