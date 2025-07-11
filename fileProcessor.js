(function() {
    window.gk_isXlsx = false;
    window.gk_xlsxFileLookup = {};
    window.gk_fileData = {};

    function filledCell(cell) {
        return cell !== '' && cell != null;
    }

    function loadFileData(filename) {
        if (window.gk_isXlsx && window.gk_xlsxFileLookup[filename]) {
            try {
                const workbook = XLSX.read(window.gk_fileData[filename], { type: 'base64' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert sheet to JSON to filter blank rows
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
                // Filter out blank rows (rows where all cells are empty, null, or undefined)
                const filteredData = jsonData.filter(row => row.some(filledCell));

                // Heuristic to find the header row by ignoring rows with fewer filled cells than the next row
                let headerRowIndex = filteredData.findIndex((row, index) =>
                    row.filter(filledCell).length >= filteredData[index + 1]?.filter(filledCell).length
                );
                // Fallback
                if (headerRowIndex === -1 || headerRowIndex > 25) {
                    headerRowIndex = 0;
                }

                // Convert filtered JSON back to CSV
                const csv = XLSX.utils.aoa_to_sheet(filteredData.slice(headerRowIndex));
                return XLSX.utils.sheet_to_csv(csv, { header: 1 });
            } catch (e) {
                console.error('Error processing XLSX file:', e);
                return "";
            }
        }
        return window.gk_fileData[filename] || "";
    }

    window.fileProcessor = {
        loadFileData
    };
})();