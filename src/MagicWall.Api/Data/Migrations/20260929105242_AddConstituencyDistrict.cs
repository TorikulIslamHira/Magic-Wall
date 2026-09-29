using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MagicWall.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddConstituencyDistrict : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DistrictCode",
                table: "Constituencies",
                type: "TEXT",
                maxLength: 60,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Constituencies_DistrictCode",
                table: "Constituencies",
                column: "DistrictCode");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Constituencies_DistrictCode",
                table: "Constituencies");

            migrationBuilder.DropColumn(
                name: "DistrictCode",
                table: "Constituencies");
        }
    }
}
