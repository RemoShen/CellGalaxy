import React from "react";
import "./FileUpload.css";

export default function FileUpload() {
  const handleFileUpload = async (fileType, file) => {
    if (!file) return;
    
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/upload/${fileType}`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        console.log(`${fileType} 文件上传成功`);
        // 可以添加成功提示
      } else {
        console.error(`${fileType} 文件上传失败:`, response.statusText);
        // 可以添加错误提示
      }
    } catch (error) {
      console.error(`${fileType} 文件上传出错:`, error);
      // 可以添加错误提示
    }
  };

  const handleFileSelect = (fileType) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = fileType === 'csv' ? '.csv' : '.zarr,.zip,.zarr.zip';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        handleFileUpload(fileType, file);
      }
    };
    input.click();
  };

  return (
    <div className="file-upload-section">
      <div className="upload-buttons">
        <button
          className="upload-btn upload-zarr"
          onClick={() => handleFileSelect('zarr')}
        >
          Upload Zarr
        </button>
        <button
          className="upload-btn upload-csv"
          onClick={() => handleFileSelect('csv')}
        >
          Upload CSV
        </button>
      </div>
    </div>
  );
}
