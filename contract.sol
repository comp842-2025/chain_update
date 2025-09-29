// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CertificateRegistry {
    address public owner;
    mapping(address => bool) public admins;
    uint256 public adminCount;

    struct Certificate {
        string productName;
        string mfgName;
        uint256 mfgDate;
        bool isValid;
    }

    mapping(string => Certificate) public certificates;

    event AdminAdded(address indexed newAdmin, address indexed addedBy);
    event AdminRemoved(address indexed removedAdmin, address indexed removedBy);
    event CertificateIssued(string indexed certId, string productName, string mfgName, uint256 mfgDate);
    event CertificateRevoked(string indexed certId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender], "Only admin");
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        adminCount = 1;
    }

    // Owner functions
    function addAdmin(address newAdmin) external onlyOwner {
        require(newAdmin != address(0), "Invalid address");
        require(!admins[newAdmin], "Already admin");
        admins[newAdmin] = true;
        adminCount++;
        emit AdminAdded(newAdmin, msg.sender);
    }

    function removeAdmin(address adminToRemove) external onlyOwner {
        require(adminToRemove != owner, "Cannot remove owner");
        require(admins[adminToRemove], "Not an admin");
        admins[adminToRemove] = false;
        adminCount--;
        emit AdminRemoved(adminToRemove, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        require(newOwner != owner, "Same owner");
        admins[owner] = false;
        admins[newOwner] = true;
        owner = newOwner;
    }

    // Admin functions
    function issueCertificate(
        string memory certId,
        string memory productName,
        string memory mfgName,
        uint256 mfgDate
    ) external onlyAdmin {
        require(bytes(certId).length > 0, "Cert ID empty");
        require(bytes(productName).length > 0, "Product empty");
        require(bytes(mfgName).length > 0, "Manufacturer empty");
        // ensure not already issued
        require(bytes(certificates[certId].productName).length == 0, "Cert ID exists");

        certificates[certId] = Certificate(productName, mfgName, mfgDate, true);
        emit CertificateIssued(certId, productName, mfgName, mfgDate);
    }

    function revokeCertificate(string memory certId) external onlyAdmin {
        require(bytes(certificates[certId].productName).length > 0, "Cert not exist");
        certificates[certId].isValid = false;
        emit CertificateRevoked(certId);
    }

    // Views
    function getCertificate(string memory certId) external view returns (
        string memory productName,
        string memory mfgName,
        uint256 mfgDate,
        bool isValid
    ) {
        Certificate memory c = certificates[certId];
        return (c.productName, c.mfgName, c.mfgDate, c.isValid);
    }

    function isAdmin(address account) external view returns (bool) {
        return admins[account];
    }

    function getAllAdminInfo() external view returns (uint256 totalAdmins, bool isCallerAdmin, bool isCallerOwner) {
        return (adminCount, admins[msg.sender], msg.sender == owner);
    }
}
