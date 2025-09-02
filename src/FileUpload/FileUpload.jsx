import React from "react";
import "./FileUpload.css";

export default function FileUpload() {
  const handleFileUpload = async (fileType, file) => {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`/upload/${fileType}`, {
      method: 'POST',
      body: formData,
    });

    if (response.ok) {
      console.log(`${fileType} 文件上传成功`);
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
